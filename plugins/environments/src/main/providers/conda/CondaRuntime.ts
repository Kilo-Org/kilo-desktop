import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import type {
	CondaEnvironmentRuntime,
	EnsureEnvironmentInput,
	EnsureEnvironmentResult,
} from "../../../contracts/capabilities.js";
import { environmentNameSchema, matchSpecSchema } from "../../../contracts/providers/conda.js";

import type { BridgeLaunchInfo } from "./resolveBridgePath.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";

// Anaconda publishes the supported llama.cpp builds on `anaconda`; `defaults`
// supplies fallback dependencies without leaking the user's channel config.
// Keep `anaconda` first because strict priority otherwise excludes its builds
// when a package with the same name also exists in `defaults`.
const FALLBACK_CHANNELS = ["anaconda", "defaults"] as const;
const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STAMP_NAME = "anaconda-ensure.json";

type Paths = typeof path.posix | typeof path.win32;

export interface CondaRuntimeOptions {
	readonly resolveBridge: () => BridgeLaunchInfo | null;
	readonly logger: MainSdkLogger;
	readonly platform?: NodeJS.Platform;
	/**
	 * Root for conda working state (envs, package cache). The sidecar's
	 * default isolation root is `~/.anaconda-agentic-desktop/conda`.
	 */
	readonly condaFilesRoot?: string;
}

/**
 * Owns lazy bridge resolution and serialized environment reconciliation
 * for main-process consumers. The bridge is resolved lazily on first
 * use; when the feature flag is off the bridge binary is never spawned
 * until a consumer actually calls `ensureEnvironment`.
 *
 * A prefix that already has `conda-meta` is reused when its recorded
 * package pin still matches the request, so startup does not re-run
 * `conda create`. A different pin recreates the prefix. An incomplete
 * prefix (present without `conda-meta`) is removed first so create is
 * not blocked. Identical concurrent requests share one operation, while
 * distinct writes serialize because every environment uses the same
 * isolated package cache.
 */
export class CondaRuntime implements CondaEnvironmentRuntime {
	readonly #resolveBridge: () => BridgeLaunchInfo | null;
	readonly #logger: MainSdkLogger;
	readonly #platform: NodeJS.Platform;
	readonly #condaFilesRoot: string;
	readonly #jobs = new Map<string, Promise<EnsureEnvironmentResult>>();
	#backend: SidecarCondaBackend | undefined;
	#tail: Promise<void> = Promise.resolve();

	constructor(options: CondaRuntimeOptions) {
		this.#resolveBridge = options.resolveBridge;
		this.#logger = options.logger;
		this.#platform = options.platform ?? process.platform;
		this.#condaFilesRoot = options.condaFilesRoot ?? resolveDefaultCondaFilesRoot(this.#platform);
	}

	async ensureEnvironment(input: EnsureEnvironmentInput): Promise<EnsureEnvironmentResult> {
		const name = environmentNameSchema.parse(input.name);
		const packages = [...new Set(input.packages.map((spec) => matchSpecSchema.parse(spec)))].sort();
		const key = JSON.stringify([name, packages]);
		const active = this.#jobs.get(key);
		if (active) return active;

		const job = this.#tail.then(() => this.#ensure(name, packages));
		const tracked = job.finally(() => {
			if (this.#jobs.get(key) === tracked) this.#jobs.delete(key);
		});
		this.#jobs.set(key, tracked);
		this.#tail = tracked.then(
			() => undefined,
			() => undefined,
		);
		return tracked;
	}

	executable(prefixPath: string, name: string): string {
		if (!EXECUTABLE_NAME_PATTERN.test(name)) {
			throw new Error(`Invalid executable name: ${name}`);
		}
		if (this.#platform === "win32") {
			const executable = name.endsWith(".exe") ? name : `${name}.exe`;
			return path.win32.join(prefixPath, "Library", "bin", executable);
		}
		return path.posix.join(prefixPath, "bin", name);
	}

	#ensureBackend(): SidecarCondaBackend {
		if (this.#backend) return this.#backend;
		const launchInfo = this.#resolveBridge();
		if (!launchInfo) {
			throw new Error(
				"[conda-runtime] anaconda-bridge-sidecar payload not found. " +
					"Ensure the bridge is packaged or BRIDGE_PAYLOAD is set.",
			);
		}
		this.#logger.info(
			`[conda-runtime] Using anaconda-bridge-sidecar v${launchInfo.version}: ${launchInfo.command.join(" ")}`,
		);
		this.#backend = new SidecarCondaBackend({
			command: launchInfo.command,
			logger: this.#logger,
		});
		return this.#backend;
	}

	async #ensure(name: string, packages: readonly string[]): Promise<EnsureEnvironmentResult> {
		const paths = this.#platform === "win32" ? path.win32 : path.posix;
		const prefixPath = paths.join(this.#condaFilesRoot, "envs", name);
		if (await ready(prefixPath, paths)) {
			const stamp = await readStamp(prefixPath, paths);
			if (stamp === undefined || samePin(stamp, packages)) {
				if (stamp === undefined) await writeStamp(prefixPath, packages, paths);
				this.#logger.info(`Reusing conda environment "${name}" at ${prefixPath}.`);
				return { condaBinPath: "", prefixPath };
			}
		}
		await rm(prefixPath, { recursive: true, force: true });

		const backend = this.#ensureBackend();
		const channels = resolveChannels(packages);
		this.#logger.info(`Creating conda environment "${name}" at ${prefixPath}.`);
		await backend.create({ name, packages: packages as string[], channels });
		if (await ready(prefixPath, paths)) await writeStamp(prefixPath, packages, paths);
		return { condaBinPath: "", prefixPath };
	}
}

function resolveDefaultCondaFilesRoot(platform: NodeJS.Platform): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const paths = platform === "win32" ? path.win32 : path.posix;
	return paths.join(home, ".anaconda-agentic-desktop", "conda");
}

async function ready(prefixPath: string, paths: Paths): Promise<boolean> {
	try {
		const info = await stat(paths.join(prefixPath, "conda-meta"));
		return info.isDirectory();
	} catch (error) {
		const code = error instanceof Error && "code" in error ? error.code : undefined;
		if (code === "ENOENT" || code === "ENOTDIR") return false;
		throw error;
	}
}

function stampPath(prefixPath: string, paths: Paths): string {
	return paths.join(prefixPath, STAMP_NAME);
}

async function readStamp(prefixPath: string, paths: Paths): Promise<string[] | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(stampPath(prefixPath, paths), "utf8"));
		if (!parsed || typeof parsed !== "object" || !("packages" in parsed)) return undefined;
		const packages = parsed.packages;
		if (!Array.isArray(packages) || packages.some((spec) => typeof spec !== "string")) {
			return undefined;
		}
		return packages;
	} catch (error) {
		const code = error instanceof Error && "code" in error ? error.code : undefined;
		if (code === "ENOENT" || error instanceof SyntaxError) return undefined;
		throw error;
	}
}

async function writeStamp(
	prefixPath: string,
	packages: readonly string[],
	paths: Paths,
): Promise<void> {
	await writeFile(stampPath(prefixPath, paths), `${JSON.stringify({ packages })}\n`, "utf8");
}

function samePin(stamp: readonly string[], packages: readonly string[]): boolean {
	return JSON.stringify(stamp.toSorted()) === JSON.stringify(packages.toSorted());
}

function resolveChannels(packages: readonly string[]): string[] {
	const explicit = packages.flatMap((spec) => {
		const separator = spec.indexOf("::");
		return separator > 0 ? [spec.slice(0, separator)] : [];
	});
	return [...new Set([...explicit, ...FALLBACK_CHANNELS])];
}
