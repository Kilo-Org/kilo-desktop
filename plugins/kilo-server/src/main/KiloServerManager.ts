import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";
import { execa } from "execa";
import isEqual from "lodash/isEqual.js";

import type { KiloServerConnection, KiloServerStatus } from "../contracts/schemas.js";
import type { KiloConfigOverlay } from "../contracts/schemas.js";
import { KILO_CLI_VERSION } from "./cli-distribution/artifacts.js";
import type { ContributedEnvManager } from "./ContributedEnvManager.js";

const execFile = promisify(execFileCallback);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_CORS_ORIGINS = [
	"anaconda-agentic-desktop://app",
	"anaconda-agentic-desktop-dev://app",
] as const;
const GENERIC_STARTUP_ERROR = "Kilo server failed to start.";

class KiloOperationalError extends Error {}

export interface KiloInstallation {
	readonly executablePath: string;
	readonly treeSitterWasmDirectory: string;
}

export interface KiloChildProcess {
	readonly pid?: number;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	readonly exitCode: number | null;
	kill(signal?: NodeJS.Signals | number): boolean;
	on: EventEmitter["on"];
	once: EventEmitter["once"];
	off: EventEmitter["off"];
}

export interface KiloLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface KiloServerManagerOptions {
	readonly installation: KiloInstallation;
	readonly runtimeDirectory: string;
	/**
	 * App-local XDG state root (Electron plugin storage). Config/data/cache stay on
	 * the shared host XDG paths so auth and sessions match Kilo CLI / VS Code.
	 * Honors an existing `XDG_STATE_HOME` in `environment` when present.
	 */
	readonly stateDirectory: string;
	readonly expectedVersion?: string;
	readonly allowVersionMismatch?: boolean;
	readonly corsOrigins?: readonly string[];
	readonly environment?: NodeJS.ProcessEnv;
	readonly contributedEnv?: ContributedEnvManager;
	readonly platform?: NodeJS.Platform;
	readonly fetch: typeof fetch;
	readonly spawn?: (
		executablePath: string,
		args: readonly string[],
		options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv },
	) => KiloChildProcess;
	readonly signalProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
	readonly killWindowsTree?: (pid: number) => Promise<void>;
	readonly onStatusChange?: (status: KiloServerStatus) => void;
	readonly logger: KiloLogger;
	readonly startupTimeoutMs?: number;
	readonly healthTimeoutMs?: number;
	readonly healthRequestTimeoutMs?: number;
	readonly healthRetryDelayMs?: number;
	readonly shutdownTimeoutMs?: number;
}

function appendNoProxy(current: string | undefined): string {
	const entries = new Set(
		(current ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
	entries.add("127.0.0.1");
	entries.add("localhost");
	return [...entries].join(",");
}

function defaultSpawn(
	executablePath: string,
	args: readonly string[],
	options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv },
): KiloChildProcess {
	return execa(executablePath, args, {
		...options,
		buffer: false,
		reject: false,
		stderr: "pipe",
		stdout: "pipe",
		windowsHide: true,
	}) as unknown as KiloChildProcess;
}

function safeErrorMessage(error: unknown, secrets: readonly string[] = []): string {
	let message = error instanceof Error ? error.message : String(error);
	for (const secret of secrets) {
		if (secret) message = message.replaceAll(secret, "[REDACTED]");
	}
	return message || "Kilo server failed.";
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Compose the `KILO_CONFIG_CONTENT` value for the spawn env: the contributed
 * overlay merged over any value already present in the inherited environment
 * (e.g. a developer-set override). Returns `undefined` when there is nothing
 * to inject, so the variable is only set when it carries content.
 *
 * Overlays are `mcp`-only (see `KiloConfigOverlay`), so the merge is simple:
 * inherited top-level keys pass through untouched and `mcp` entries are
 * merged per id, overlay entries winning. This is intentionally NOT a full
 * reimplementation of `mergeConfig` in `@kilocode/sdk` (which also
 * per-entry-merges `agent`/`command`/`mode` and concatenates
 * `plugin`/`instructions`) — widening the overlay type requires adopting
 * those semantics here and in `getMergedConfigOverlay`.
 *
 * The `mcp` accumulator is prototype-less: entry ids become object keys, and
 * a plain `{}` would let a reserved id like `__proto__` mutate the
 * accumulator's prototype via bracket assignment (see the matching guard in
 * `ContributedEnvManager.getMergedConfigOverlay`).
 */
function composeConfigContent(
	inherited: string | undefined,
	overlay: KiloConfigOverlay | undefined,
): string | undefined {
	if (overlay === undefined) return inherited;
	let base: Record<string, unknown> = {};
	if (inherited) {
		try {
			const parsed: unknown = JSON.parse(inherited);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				base = parsed as Record<string, unknown>;
			}
		} catch {
			// Malformed inherited content: the overlay alone is still valid.
		}
	}
	const baseMcp = base.mcp;
	const merged: Record<string, unknown> = { ...base };
	if (overlay.mcp !== undefined || baseMcp !== undefined) {
		const mcp: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		if (baseMcp !== null && typeof baseMcp === "object" && !Array.isArray(baseMcp)) {
			Object.assign(mcp, baseMcp);
		}
		if (overlay.mcp !== undefined) Object.assign(mcp, overlay.mcp);
		merged.mcp = mcp;
	}
	return JSON.stringify(merged);
}

export class KiloServerManager {
	readonly #options: Required<
		Pick<
			KiloServerManagerOptions,
			| "expectedVersion"
			| "allowVersionMismatch"
			| "corsOrigins"
			| "environment"
			| "platform"
			| "fetch"
			| "spawn"
			| "signalProcessGroup"
			| "killWindowsTree"
			| "onStatusChange"
			| "logger"
			| "startupTimeoutMs"
			| "healthTimeoutMs"
			| "healthRequestTimeoutMs"
			| "healthRetryDelayMs"
			| "shutdownTimeoutMs"
		>
	> &
		Pick<KiloServerManagerOptions, "installation" | "runtimeDirectory" | "stateDirectory">;
	readonly #contributedEnv: ContributedEnvManager | undefined;
	readonly #intentionalExits = new WeakSet<KiloChildProcess>();
	#status: KiloServerStatus = { status: "stopped" };
	#child: KiloChildProcess | undefined;
	#connection: (KiloServerConnection & { pid: number }) | undefined;
	#startPromise: Promise<KiloServerConnection> | undefined;
	#disposed = false;
	/**
	 * Snapshot of the sanitized contributed env used at the last spawn.
	 * Used by `contributedEnvChangedSinceSpawn()` to skip no-op restarts
	 * when a contribution turns out to already be reflected in the running
	 * child (e.g. a contribution that arrived during boot and was captured
	 * by `#createEnvironment` before the spawn completed).
	 */
	#lastSpawnedContributedEnv: Record<string, string> = {};
	/**
	 * `KILO_CONFIG_CONTENT` value (composed inherited + overlay) used at the
	 * last spawn. Compared alongside `#lastSpawnedContributedEnv` for drift.
	 */
	#lastSpawnedConfigContent: string | undefined;

	constructor(options: KiloServerManagerOptions) {
		this.#options = {
			installation: options.installation,
			runtimeDirectory: options.runtimeDirectory,
			stateDirectory: options.stateDirectory,
			expectedVersion: options.expectedVersion ?? KILO_CLI_VERSION,
			allowVersionMismatch: options.allowVersionMismatch ?? false,
			corsOrigins: options.corsOrigins ?? DEFAULT_CORS_ORIGINS,
			environment: options.environment ?? process.env,
			platform: options.platform ?? process.platform,
			fetch: options.fetch,
			spawn: options.spawn ?? defaultSpawn,
			signalProcessGroup:
				options.signalProcessGroup ?? ((pid, signal) => process.kill(-pid, signal)),
			killWindowsTree:
				options.killWindowsTree ??
				(async (pid) => {
					await execFile("taskkill", ["/PID", String(pid), "/T", "/F"], {
						windowsHide: true,
					});
				}),
			onStatusChange: options.onStatusChange ?? (() => undefined),
			logger: options.logger,
			startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
			healthTimeoutMs: options.healthTimeoutMs ?? 10_000,
			healthRequestTimeoutMs: options.healthRequestTimeoutMs ?? 3_000,
			healthRetryDelayMs: options.healthRetryDelayMs ?? 250,
			shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
		};
		this.#contributedEnv = options.contributedEnv;
	}

	get status(): KiloServerStatus {
		return structuredClone(this.#status);
	}

	get isRunning(): boolean {
		return this.#connection !== undefined;
	}

	/**
	 * True while `ensureRunning()` has an in-flight spawn but the child is
	 * not yet ready. Distinct from `isRunning` (which flips true only after
	 * the health check passes). Used by `handleEnvChange` to decide whether
	 * to await an in-flight spawn before evaluating drift — otherwise a
	 * contribution that arrived mid-spawn is missed until an unrelated
	 * contribution triggers a fresh restart.
	 */
	get isStarting(): boolean {
		return this.#startPromise !== undefined;
	}

	/**
	 * True when the currently-merged contributed env differs from the snapshot
	 * captured at the last spawn. Callers debouncing restarts on env changes
	 * can use this to skip no-op restarts — e.g. when a contribution arrived
	 * during boot and was already captured in the initial spawn env.
	 *
	 * Returns true when the server has never spawned (nothing to compare
	 * against yet); the caller can then decide to spawn instead of restart.
	 */
	contributedEnvChangedSinceSpawn(): boolean {
		if (!this.#contributedEnv) return false;
		if (this.#connection === undefined && this.#startPromise === undefined) return true;
		const current = this.#sanitizeContributedEnv(this.#contributedEnv.getMergedEnv());
		if (!isEqual(current, this.#lastSpawnedContributedEnv)) return true;
		return this.#composeCurrentConfigContent() !== this.#lastSpawnedConfigContent;
	}

	ensureRunning(): Promise<KiloServerConnection> {
		if (this.#disposed) {
			return Promise.reject(new FeatureError("Kilo Code has shut down.", "BUSINESS"));
		}
		if (this.#connection) return Promise.resolve(this.#publicConnection(this.#connection));
		if (this.#startPromise) return this.#startPromise;

		this.#startPromise = this.#start().finally(() => {
			this.#startPromise = undefined;
		});
		return this.#startPromise;
	}

	async restart(): Promise<KiloServerConnection> {
		if (this.#startPromise) {
			await this.#startPromise.catch(() => undefined);
		}
		await this.#stop();
		return this.ensureRunning();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#connection = undefined;
		this.#setStatus({ status: "stopped" });
		void this.#stop();
	}

	async #start(): Promise<KiloServerConnection> {
		this.#setStatus({ status: "starting" });
		const password = randomBytes(32).toString("hex");
		const authHeader = `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}`;
		let child: KiloChildProcess | undefined;
		try {
			await this.#ensureRuntimeDirectory();
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			const environment = this.#createEnvironment(password);
			const args = [
				"serve",
				"--hostname=127.0.0.1",
				"--port=0",
				...this.#options.corsOrigins.map((origin) => `--cors=${origin}`),
			];
			child = this.#options.spawn(this.#options.installation.executablePath, args, {
				cwd: this.#options.runtimeDirectory,
				detached: this.#options.platform !== "win32",
				env: environment,
			});
			if (!child.pid) {
				throw new KiloOperationalError("Kilo server did not provide a process id.");
			}
			this.#child = child;
			this.#watchChild(child);
			child.stderr?.resume();

			const baseUrl = await this.#waitForListeningUrl(child);
			const version = await this.#waitForHealthy(baseUrl, authHeader);
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			if (!this.#options.allowVersionMismatch && version !== this.#options.expectedVersion) {
				throw new KiloOperationalError(
					`Kilo server version mismatch: expected ${this.#options.expectedVersion}, got ${version}.`,
				);
			}

			const connection = {
				baseUrl,
				username: "kilo",
				password,
				version,
				globalDirectory: this.#options.runtimeDirectory,
				pid: child.pid,
			};
			this.#connection = connection;
			this.#setStatus({ status: "ready", baseUrl, version });
			this.#options.logger.info(`Ready at ${baseUrl} (version ${version}).`);
			return this.#publicConnection(connection);
		} catch (error) {
			if (child) await this.#terminate(child);
			const internalMessage = safeErrorMessage(error, [password, authHeader]);
			const publicMessage =
				error instanceof KiloOperationalError ? internalMessage : GENERIC_STARTUP_ERROR;
			this.#connection = undefined;
			if (this.#disposed) {
				this.#setStatus({ status: "stopped" });
				throw new FeatureError("Kilo Code has shut down.", "BUSINESS");
			}
			this.#setStatus({ status: "error", message: publicMessage });
			this.#options.logger.error(internalMessage);
			throw new FeatureError(publicMessage, "BUSINESS");
		}
	}

	/**
	 * Ensures a stable cwd and app-local state root. Config/data/cache still use the
	 * shared host XDG paths so auth and sessions match Kilo CLI / VS Code
	 * (`~/.config/kilo`, `~/.local/share/kilo`, etc.).
	 */
	async #ensureRuntimeDirectory(): Promise<void> {
		await Promise.all([
			mkdir(this.#options.runtimeDirectory, { recursive: true }),
			mkdir(this.#options.stateDirectory, { recursive: true }),
		]);
	}

	/**
	 * Reserved env keys contributors cannot override. Compared case-insensitively
	 * (Windows treats env var names case-insensitively at the CreateProcess /
	 * libuv layer, and macOS/Linux tools sometimes ship UPPER-and lower- variants
	 * in the same environment — sanitize both).
	 *
	 * The list is split into exact-match and prefix-match tiers:
	 *
	 * - **Exact:** individual keys with security or protocol semantics. Includes
	 *   process-search hijacks (`PATH`), dynamic-linker shim variables
	 *   (`LD_LIBRARY_PATH`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`) that could
	 *   inject arbitrary code into the child, proxy bypasses (`NO_PROXY`), Node
	 *   runtime hooks (`NODE_OPTIONS`), Electron-as-Node (`ELECTRON_RUN_AS_NODE`),
	 *   and Kilo's per-launch identity (`KILO_SERVER_PASSWORD`, `KILO_PARENT_PID`)
	 *   plus its resource pointers (`KILO_TREE_SITTER_WASM_DIR`).
	 *
	 * - **Prefix:** whole namespaces we reserve to Kilo (`KILO_`) and the XDG
	 *   spec (`XDG_`), plus the macOS dynamic linker family (`DYLD_`) and Linux
	 *   loader-preload family (`LD_`). Reserving prefixes prevents a contributor
	 *   from shipping a future variant we haven't enumerated (e.g.
	 *   `DYLD_FALLBACK_LIBRARY_PATH`, a new `KILO_*` knob).
	 */
	static readonly #RESERVED_EXACT_UPPER = new Set([
		"PATH",
		"NO_PROXY",
		"NODE_OPTIONS",
		"ELECTRON_RUN_AS_NODE",
	]);

	static readonly #RESERVED_PREFIXES_UPPER = ["KILO_", "XDG_", "DYLD_", "LD_"] as const;

	static #isReservedEnvKey(key: string): boolean {
		const upper = key.toUpperCase();
		if (KiloServerManager.#RESERVED_EXACT_UPPER.has(upper)) return true;
		return KiloServerManager.#RESERVED_PREFIXES_UPPER.some((prefix) => upper.startsWith(prefix));
	}

	/**
	 * Filter contributed env by reserved keys (case-insensitive because Windows
	 * treats env var names case-insensitively at the CreateProcess/libuv layer).
	 * Also used by `contributedEnvChangedSinceSpawn` to compare against the
	 * snapshot taken at spawn time.
	 */
	#sanitizeContributedEnv(contributed: Record<string, string>): Record<string, string> {
		const sanitized: Record<string, string> = {};
		for (const [key, value] of Object.entries(contributed)) {
			if (KiloServerManager.#isReservedEnvKey(key)) {
				this.#options.logger.warn(`Contributed env key "${key}" is reserved and will be ignored.`);
				continue;
			}
			sanitized[key] = value;
		}
		return sanitized;
	}

	/** Current `KILO_CONFIG_CONTENT` value: inherited env value + merged overlay. */
	#composeCurrentConfigContent(): string | undefined {
		return composeConfigContent(
			this.#options.environment.KILO_CONFIG_CONTENT,
			this.#contributedEnv?.getMergedConfigOverlay(),
		);
	}

	#createEnvironment(password: string): NodeJS.ProcessEnv {
		const contributed = this.#contributedEnv ? this.#contributedEnv.getMergedEnv() : {};
		const sanitizedContributed = this.#sanitizeContributedEnv(contributed);
		const configContent = this.#composeCurrentConfigContent();
		// Snapshot for drift detection; a subsequent env change that matches
		// this snapshot won't trigger a restart.
		this.#lastSpawnedContributedEnv = { ...sanitizedContributed };
		this.#lastSpawnedConfigContent = configContent;

		const environment: NodeJS.ProcessEnv = {
			...this.#options.environment,
			...sanitizedContributed,
			// Config overlay channel. Contributors cannot set KILO_* directly
			// (reserved prefix); overlays flow through the dedicated
			// `configOverlay.contribute` capability instead and are composed
			// here, merged over any inherited KILO_CONFIG_CONTENT.
			...(configContent !== undefined ? { KILO_CONFIG_CONTENT: configContent } : {}),
			KILO_SERVER_PASSWORD: password,
			KILO_PARENT_PID: String(process.pid),
			KILO_ENABLE_QUESTION_TOOL: "true",
			KILO_TREE_SITTER_WASM_DIR: this.#options.installation.treeSitterWasmDirectory,
			// Match OpenCode desktop: isolate state under Electron storage, keep shared data.
			XDG_STATE_HOME: this.#options.environment.XDG_STATE_HOME ?? this.#options.stateDirectory,
			NO_PROXY: appendNoProxy(this.#options.environment.NO_PROXY),
			no_proxy: appendNoProxy(this.#options.environment.no_proxy),
		};
		// Case-insensitive scrub of dangerous keys, in case any case-variant
		// survived the spread from process.env.
		for (const name of Object.keys(environment)) {
			const upper = name.toUpperCase();
			if (upper === "NODE_OPTIONS" || upper === "ELECTRON_RUN_AS_NODE") {
				delete environment[name];
			}
		}
		if (this.#options.platform === "linux") {
			for (const name of Object.keys(environment)) {
				if (name.toUpperCase() === "LD_PRELOAD") delete environment[name];
			}
		}
		if (this.#options.platform === "darwin") {
			for (const name of Object.keys(environment)) {
				if (name.toUpperCase().startsWith("DYLD_")) delete environment[name];
			}
		}
		return environment;
	}

	#watchChild(child: KiloChildProcess): void {
		child.on("exit", (exitCode, signal) => {
			if (this.#child !== child) return;
			this.#child = undefined;
			this.#connection = undefined;
			if (this.#intentionalExits.has(child) || this.#disposed) return;
			const detail = signal ? `signal ${signal}` : `exit code ${exitCode ?? "unknown"}`;
			const message = `Kilo server exited unexpectedly (${detail}).`;
			this.#setStatus({ status: "error", message });
			this.#options.logger.warn(message);
		});
	}

	#waitForListeningUrl(child: KiloChildProcess): Promise<string> {
		if (!child.stdout) {
			return Promise.reject(new KiloOperationalError("Kilo server stdout is unavailable."));
		}
		return new Promise((resolve, reject) => {
			const lines = createInterface({ input: child.stdout! });
			const timeout = setTimeout(() => {
				cleanup();
				reject(
					new KiloOperationalError(
						"Kilo server did not report a listening URL before startup timed out.",
					),
				);
			}, this.#options.startupTimeoutMs);
			const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
				cleanup();
				reject(
					new KiloOperationalError(
						`Kilo server exited before becoming ready (${signal ?? `code ${exitCode ?? "unknown"}`}).`,
					),
				);
			};
			const cleanup = () => {
				clearTimeout(timeout);
				lines.close();
				child.stdout?.resume();
				child.off("exit", onExit);
			};
			child.on("exit", onExit);
			lines.on("line", (line) => {
				const match = /\bon\s+(https?:\/\/[^\s]+)/i.exec(line);
				if (!match?.[1]) return;
				try {
					const url = new URL(match[1].replace(/[),.;]+$/, ""));
					if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || !url.port) {
						throw new KiloOperationalError(
							`Kilo reported a non-loopback listening URL: ${url.origin}`,
						);
					}
					cleanup();
					resolve(url.origin);
				} catch (error) {
					cleanup();
					reject(error);
				}
			});
		});
	}

	async #waitForHealthy(baseUrl: string, authorization: string): Promise<string> {
		const deadline = Date.now() + this.#options.healthTimeoutMs;
		let lastError: unknown = new KiloOperationalError("Kilo health check did not complete.");
		while (Date.now() <= deadline) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.#options.healthRequestTimeoutMs);
			try {
				const response = await this.#options.fetch(`${baseUrl}/global/health`, {
					headers: { Authorization: authorization },
					signal: controller.signal,
				});
				if (response.status === 401) {
					throw new KiloOperationalError("Kilo server rejected its per-launch credentials.");
				}
				if (response.ok) {
					const health = (await response.json()) as { healthy?: unknown; version?: unknown };
					if (health.healthy !== true || typeof health.version !== "string" || !health.version) {
						throw new KiloOperationalError("Kilo server returned an invalid health response.");
					}
					return health.version;
				}
				lastError = new KiloOperationalError(`Kilo health check returned HTTP ${response.status}.`);
			} catch (error) {
				lastError = error;
				if (error instanceof Error && error.message.includes("per-launch credentials")) throw error;
			} finally {
				clearTimeout(timeout);
			}
			if (Date.now() >= deadline) break;
			await delay(this.#options.healthRetryDelayMs);
		}
		throw lastError;
	}

	async #stop(): Promise<void> {
		const child = this.#child;
		this.#child = undefined;
		this.#connection = undefined;
		if (!child) return;
		await this.#terminate(child);
		if (!this.#disposed) this.#setStatus({ status: "stopped" });
	}

	async #terminate(child: KiloChildProcess): Promise<void> {
		this.#intentionalExits.add(child);
		if (child.exitCode !== null) return;
		const pid = child.pid;
		try {
			if (this.#options.platform !== "win32" && pid) {
				this.#options.signalProcessGroup(pid, "SIGTERM");
			} else {
				child.kill("SIGTERM");
			}
		} catch {
			child.kill("SIGTERM");
		}
		if (await this.#waitForExit(child, this.#options.shutdownTimeoutMs)) return;

		try {
			if (this.#options.platform === "win32" && pid) {
				await this.#options.killWindowsTree(pid);
			} else if (pid) {
				this.#options.signalProcessGroup(pid, "SIGKILL");
			} else {
				child.kill("SIGKILL");
			}
		} catch (error) {
			this.#options.logger.warn(`Failed to force-stop Kilo: ${safeErrorMessage(error)}.`);
		}
	}

	#waitForExit(child: KiloChildProcess, timeoutMs: number): Promise<boolean> {
		if (child.exitCode !== null) return Promise.resolve(true);
		return new Promise((resolve) => {
			const onExit = () => {
				clearTimeout(timeout);
				resolve(true);
			};
			const timeout = setTimeout(() => {
				child.off("exit", onExit);
				resolve(false);
			}, timeoutMs);
			child.once("exit", onExit);
		});
	}

	#setStatus(status: KiloServerStatus): void {
		this.#status = status;
		this.#options.onStatusChange(structuredClone(status));
	}

	#publicConnection(connection: KiloServerConnection & { pid: number }): KiloServerConnection {
		return {
			baseUrl: connection.baseUrl,
			username: connection.username,
			password: connection.password,
			version: connection.version,
			globalDirectory: connection.globalDirectory,
		};
	}
}
