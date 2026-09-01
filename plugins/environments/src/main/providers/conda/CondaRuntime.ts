import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import type {
	CondaEnvironmentRuntime,
	EnsureEnvironmentInput,
	EnsureEnvironmentResult,
} from "../../../contracts/capabilities.js";
import { environmentNameSchema, matchSpecSchema } from "../../../contracts/providers/conda.js";

import type { StagingResult } from "./staging/index.js";

// Anaconda publishes the supported llama.cpp builds on `anaconda`; `defaults`
// supplies fallback dependencies without leaking the user's channel config.
// Keep `anaconda` first because strict priority otherwise excludes its builds
// when a package with the same name also exists in `defaults`.
const FALLBACK_CHANNELS = ["anaconda", "defaults"] as const;
const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STAMP_NAME = "anaconda-ensure.json";

interface ExecuteOptions {
	readonly env: Record<string, string>;
}

type Execute = (file: string, args: readonly string[], options: ExecuteOptions) => Promise<unknown>;

type Paths = typeof path.posix | typeof path.win32;

export interface CondaRuntimeOptions {
	readonly stage: () => Promise<StagingResult>;
	readonly logger: MainSdkLogger;
	readonly execute?: Execute;
	readonly platform?: NodeJS.Platform;
}

/**
 * Owns lazy conda staging and serialized environment reconciliation for
 * main-process consumers. Staging starts only when a caller requests an
 * environment (or the environments UI explicitly boots its provider).
 * A prefix that already has `conda-meta` is reused when its recorded
 * package pin still matches the request, so startup does not re-run
 * `conda create`. A different pin recreates the prefix. An incomplete
 * prefix (present without `conda-meta`) is removed first so create is
 * not blocked. Identical concurrent requests share one operation, while
 * distinct writes serialize because every environment uses the same
 * isolated package cache.
 */
export class CondaRuntime implements CondaEnvironmentRuntime {
	readonly #stageConda: () => Promise<StagingResult>;
	readonly #logger: MainSdkLogger;
	readonly #execute: Execute;
	readonly #platform: NodeJS.Platform;
	readonly #jobs = new Map<string, Promise<EnsureEnvironmentResult>>();
	#staging: Promise<StagingResult> | undefined;
	#tail: Promise<void> = Promise.resolve();

	constructor(options: CondaRuntimeOptions) {
		this.#stageConda = options.stage;
		this.#logger = options.logger;
		this.#execute =
			options.execute ?? ((file, args, executeOptions) => execa(file, [...args], executeOptions));
		this.#platform = options.platform ?? process.platform;
	}

	stage(): Promise<StagingResult> {
		if (this.#staging) return this.#staging;

		const pending = this.#stageConda();
		const staging = pending.catch((error: unknown) => {
			if (this.#staging === staging) this.#staging = undefined;
			throw error;
		});
		this.#staging = staging;
		return staging;
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

	async #ensure(name: string, packages: readonly string[]): Promise<EnsureEnvironmentResult> {
		const staged = await this.stage();
		const paths = this.#platform === "win32" ? path.win32 : path.posix;
		const prefixPath = paths.join(staged.condaFilesRoot, "envs", name);
		if (await ready(prefixPath, paths)) {
			const stamp = await readStamp(prefixPath, paths);
			if (stamp === undefined || samePin(stamp, packages)) {
				if (stamp === undefined) await writeStamp(prefixPath, packages, paths);
				this.#logger.info(`Reusing conda environment "${name}" at ${prefixPath}.`);
				return { condaBinPath: staged.condaBinPath, prefixPath };
			}
		}
		await rm(prefixPath, { recursive: true, force: true });
		const channels = resolveChannels(packages);
		const args = [
			"create",
			"--prefix",
			prefixPath,
			"--yes",
			"--override-channels",
			"--strict-channel-priority",
			...channels.flatMap((channel) => ["--channel", channel]),
			...(packages.length > 0 ? ["--", ...packages] : []),
		];

		this.#logger.info(`Creating conda environment "${name}" at ${prefixPath}.`);
		await this.#execute(staged.condaBinPath, args, {
			env: isolationEnvironment(staged.condaFilesRoot, this.#platform),
		});
		if (await ready(prefixPath, paths)) await writeStamp(prefixPath, packages, paths);
		return { condaBinPath: staged.condaBinPath, prefixPath };
	}
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

function isolationEnvironment(root: string, platform: NodeJS.Platform): Record<string, string> {
	const paths = platform === "win32" ? path.win32 : path.posix;
	return {
		CONDA_ENVS_PATH: paths.join(root, "envs"),
		CONDA_PKGS_DIRS: paths.join(root, "pkgs"),
		CONDARC: paths.join(root, ".condarc"),
		CONDA_PLUGINS_AUTO_ACCEPT_TOS: "yes",
	};
}
