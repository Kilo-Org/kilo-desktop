import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { promisify, stripVTControlCharacters } from "node:util";

import { KernelError } from "@kilo-desktop/kernel";
import { execa } from "execa";
import isEqual from "lodash/isEqual.js";

import type { KiloServerConnection, KiloServerStatus } from "./types.js";
import { KILO_CLI_VERSION } from "./cli-distribution/artifacts.js";
import type { ContributedEnvManager } from "./ContributedEnvManager.js";
import { kiloInlineConfigContent } from "./kilo-inline-config.js";
import { listManagedKiloPluginFiles } from "./managed-kilo-plugins.js";
import { WEBMCP_ENDPOINT_TOKEN_ENV, WEBMCP_ENDPOINT_URL_ENV } from "./webmcp-relay-config.js";

const execFile = promisify(execFileCallback);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const GENERIC_STARTUP_ERROR = "Kilo server failed to start.";

// Dropped from the inherited env so the host shell can't hand the CLI a Kilo credential.
const INHERITED_KILO_CREDENTIAL_ENV = new Set(["KILO_API_KEY"]);

// The CLI's own default gateway origin, used when nothing injects KILO_API_URL.
const DEFAULT_KILO_GATEWAY_ORIGIN = "https://api.kilo.ai";

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
	 * App-owned Kilo config directory passed as `KILO_CONFIG_DIR`. Kilo merges
	 * it additively on top of the user's global config.
	 */
	readonly configDirectory: string;
	/**
	 * Desktop-owned Kilo plugin files, passed to Kilo as inline config
	 * (`KILO_CONFIG_CONTENT`) rather than placed in `configDirectory`. See
	 * `managed-kilo-plugins.ts`.
	 */
	readonly managedPluginDirectory: string;
	/** App-local XDG state root. Honors an inherited `XDG_STATE_HOME`. */
	readonly stateDirectory: string;
	/**
	 * Desktop's stable installation id, stamped as `KILO_MACHINE_ID` at every
	 * spawn so the CLI adopts the app's anonymous telemetry identity (the same
	 * value used as the PostHog `distinct_id` before login) instead of
	 * generating its own `telemetry-id`. Mirrors the VS Code host, which
	 * passes `vscode.env.machineId`.
	 */
	readonly installationId?: string;
	readonly expectedVersion?: string;
	readonly allowVersionMismatch?: boolean;
	/** Origins of the app's windows, which call the server directly. */
	readonly corsOrigins: readonly string[];
	/**
	 * The in-process WebMCP MCP endpoint, read at every spawn. Its URL and
	 * token reach Kilo as env vars because Desktop's `mcp.desktop` config entry
	 * references them through Kilo's `{env:}` substitution.
	 */
	readonly webMcpEndpoint?: () => { readonly url: string; readonly token: string } | undefined;
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
	readonly telemetryTimeoutMs?: number;
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
		extendEnv: false,
		buffer: false,
		reject: false,
		stderr: "pipe",
		stdout: "pipe",
		windowsHide: true,
	}).nodeChildProcess as KiloChildProcess;
}

function redactSecrets(text: string, secrets: readonly string[]): string {
	let result = text;
	for (const secret of secrets) {
		if (secret) result = result.replaceAll(secret, "[REDACTED]");
	}
	return result;
}

function safeErrorMessage(error: unknown, secrets: readonly string[] = []): string {
	const message = error instanceof Error ? error.message : String(error);
	return redactSecrets(message, secrets) || "Kilo server failed.";
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

const STDERR_MAX_LINES = 50;
const STDERR_MAX_BYTES = 8_192;

/**
 * Captures a bounded amount of stderr output from the child process during
 * startup. When the server exits early (e.g. due to a config validation
 * error), the collected output is included in the error message so the user
 * sees the root cause instead of a generic "failed to start" string.
 */
class StderrCollector {
	readonly #lines: string[] = [];
	#totalBytes = 0;
	#capped = false;
	readonly #stream: Readable;
	readonly #rl: ReturnType<typeof createInterface>;

	constructor(stream: Readable) {
		this.#stream = stream;
		this.#rl = createInterface({ input: stream });
		this.#rl.on("line", (line) => {
			if (this.#capped) return;
			if (this.#lines.length >= STDERR_MAX_LINES || this.#totalBytes >= STDERR_MAX_BYTES) {
				this.#capped = true;
				return;
			}
			this.#lines.push(line);
			this.#totalBytes += line.length;
		});
	}

	/**
	 * Stop listening and resume the underlying stream so the child process
	 * does not stall on a full stderr pipe buffer during normal operation.
	 */
	stop(): void {
		this.#rl.close();
		this.#stream.resume();
	}

	/**
	 * Return the collected lines joined by newlines, or an empty string if
	 * nothing was captured. VT control characters (ANSI colors, bold, etc.)
	 * are stripped so the output is readable in both log files and the
	 * renderer's error toast.
	 */
	text(): string {
		return stripVTControlCharacters(this.#lines.join("\n")).trim();
	}
}

/**
 * Append diagnostic stderr output to a startup error message. When the kilo
 * CLI prints a config-validation or other early failure to stderr, this
 * surfaces the root cause alongside the generic "failed to start" line so
 * the user can fix their config without hunting through log files.
 */
function appendStderrContext(baseMessage: string, stderr: string): string {
	if (!stderr) return baseMessage;
	return `${baseMessage}\n${stderr}`;
}

/**
 * Owns the lifecycle of the packaged `kilo serve` child process: spawn, wait
 * for the stdout handshake + `/global/health` probe, expose the connection to
 * consumers, and tear the child down cleanly on `dispose()`. Restarts are
 * serialized so a rapid restart storm coalesces into one graceful stop + one
 * fresh spawn, matching the "one server per Desktop process" invariant.
 *
 * Telemetry consent matches the VS Code client: `KILO_TELEMETRY_LEVEL` is
 * stamped after inherited env at every spawn, and the running CLI is updated
 * through `/telemetry/setEnabled` on every change and every time it becomes
 * ready. Updates are serialized and always send the latest preference, so a
 * slower earlier request cannot overwrite a later choice. Opt-out never
 * restarts the CLI; events it queued before opting out may still be sent.
 *
 * **Status emission contract.** `#setStatus` flows through an
 * `#setStatus`, gated by `isEqual`, so callers observe
 * exactly one `onStatusChange` per REAL transition. That means
 * structurally-identical consecutive writes are intentionally not re-emitted
 * — most visibly `stopped → stopped` on `dispose()` when the manager was
 * never started, and `error → error` when a mid-startup failure runs the
 * "stopped" branch after `dispose()` already emitted it. Subscribers that
 * need a periodic resync must use a separate signal (the boot progress
 * channel or an explicit refresh IPC), not the status event stream.
 *
 * `#createEnvironment` scrubs the inherited Kilo credential and passes
 * Desktop's own `KILO_CONFIG_CONTENT` (`kilo-inline-config.ts`), which pins
 * the kilo origin and makes archive commands ask, so project config cannot
 * undo either.
 */
export class KiloServerManager {
	readonly #options: Required<
		Pick<
			KiloServerManagerOptions,
			| "expectedVersion"
			| "allowVersionMismatch"
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
			| "telemetryTimeoutMs"
		>
	> &
		Pick<
			KiloServerManagerOptions,
			| "installation"
			| "runtimeDirectory"
			| "configDirectory"
			| "managedPluginDirectory"
			| "stateDirectory"
			| "corsOrigins"
		> &
		// Optional under exactOptionalPropertyTypes: absent unless the
		// preferences capability supplies one.
		Pick<KiloServerManagerOptions, "installationId" | "webMcpEndpoint">;
	readonly #contributedEnv: ContributedEnvManager | undefined;
	readonly #intentionalExits = new WeakSet<KiloChildProcess>();
	#status: KiloServerStatus = { status: "stopped" };
	#child: KiloChildProcess | undefined;
	#connection: (KiloServerConnection & { pid: number }) | undefined;
	#startPromise: Promise<KiloServerConnection> | undefined;
	#disposed = false;
	#telemetryEnabled = false;
	#telemetrySync: Promise<void> = Promise.resolve();
	/**
	 * Snapshot of the sanitized contributed env used at the last spawn.
	 * Used by `contributedEnvChangedSinceSpawn()` to skip no-op restarts
	 * when a contribution turns out to already be reflected in the running
	 * child (e.g. a contribution that arrived during boot and was captured
	 * by `#createEnvironment` before the spawn completed).
	 */
	#lastSpawnedContributedEnv: Record<string, string> = {};
	/** The tool endpoint the running server was spawned with. */
	#lastSpawnedWebMcpEndpoint: { readonly url: string; readonly token: string } | undefined;
	constructor(options: KiloServerManagerOptions) {
		this.#options = {
			installation: options.installation,
			runtimeDirectory: options.runtimeDirectory,
			configDirectory: options.configDirectory,
			managedPluginDirectory: options.managedPluginDirectory,
			stateDirectory: options.stateDirectory,
			...(options.installationId !== undefined ? { installationId: options.installationId } : {}),
			...(options.webMcpEndpoint ? { webMcpEndpoint: options.webMcpEndpoint } : {}),
			expectedVersion: options.expectedVersion ?? KILO_CLI_VERSION,
			allowVersionMismatch: options.allowVersionMismatch ?? false,
			corsOrigins: options.corsOrigins,
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
			// The CLI's first listening line has taken 20s+ when it cold-starts
			// alongside the app's other sidecars on a contended machine.
			startupTimeoutMs: options.startupTimeoutMs ?? 60_000,
			healthTimeoutMs: options.healthTimeoutMs ?? 10_000,
			healthRequestTimeoutMs: options.healthRequestTimeoutMs ?? 3_000,
			healthRetryDelayMs: options.healthRetryDelayMs ?? 250,
			shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
			telemetryTimeoutMs: options.telemetryTimeoutMs ?? 3_000,
		};
		this.#contributedEnv = options.contributedEnv;
	}

	get status(): KiloServerStatus {
		return structuredClone(this.#status);
	}

	get isRunning(): boolean {
		return this.#connection !== undefined;
	}

	async setTelemetryEnabled(enabled: boolean): Promise<void> {
		this.#telemetryEnabled = enabled;
		try {
			await this.#syncTelemetry();
		} catch (error) {
			this.#options.logger.warn(
				`Could not set Kilo CLI telemetry to ${enabled ? "on" : "off"}: ${safeErrorMessage(error)}`,
			);
			throw new KernelError(
				"BUSINESS",
				"Could not update Kilo's data collection setting. Retry the change.",
			);
		}
	}

	/** Sends the latest preference to the running CLI; a cold CLI picks it up at spawn. */
	#syncTelemetry(): Promise<void> {
		const sync = this.#telemetrySync
			.catch(() => undefined)
			.then(async () => {
				const connection = this.#connection;
				if (!connection || this.#disposed) return;
				const enabled = this.#telemetryEnabled;
				await this.#updateTelemetry(connection, enabled);
				this.#options.logger.info(`Kilo CLI telemetry set to ${enabled ? "on" : "off"}`);
			});
		this.#telemetrySync = sync;
		return sync;
	}

	async #updateTelemetry(connection: KiloServerConnection, enabled: boolean): Promise<void> {
		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					const response = await this.#options.fetch(`${connection.baseUrl}/telemetry/setEnabled`, {
						method: "POST",
						headers: {
							Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ enabled }),
						signal: controller.signal,
					});
					if (!response.ok || (await response.json()) !== true) {
						throw new Error("Kilo did not acknowledge telemetry consent.");
					}
				})(),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => {
						controller.abort();
						reject(new Error("Kilo telemetry consent request timed out."));
					}, this.#options.telemetryTimeoutMs);
				}),
			]);
		} finally {
			clearTimeout(timeout);
		}
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
		return !isEqual(current, this.#lastSpawnedContributedEnv);
	}

	/** True when a running (or starting) server was spawned with another tool endpoint than the current one. */
	webMcpEndpointChangedSinceSpawn(): boolean {
		if (this.#connection === undefined && this.#startPromise === undefined) return false;
		const current = this.#options.webMcpEndpoint?.();
		const spawned = this.#lastSpawnedWebMcpEndpoint;
		return current?.url !== spawned?.url || current?.token !== spawned?.token;
	}

	ensureRunning(): Promise<KiloServerConnection> {
		if (this.#disposed) {
			return Promise.reject(new KernelError("BUSINESS", "Kilo Code has shut down."));
		}
		if (this.#connection) return Promise.resolve(this.#publicConnection(this.#connection));
		if (this.#startPromise) return this.#startPromise;

		this.#startPromise = this.#start().finally(() => {
			this.#startPromise = undefined;
		});
		return this.#startPromise;
	}

	async restart(): Promise<KiloServerConnection> {
		if (this.#disposed) {
			return Promise.reject(new KernelError("BUSINESS", "Kilo Code has shut down."));
		}
		if (this.#startPromise) {
			await this.#startPromise.catch(() => undefined);
		}
		// Reuse the port AND credentials the running server is bound to so the
		// renderer's cached connection (baseUrl + password) stays fully valid
		// across the restart and the chat runtime does not have to reconnect.
		const previousPort = this.#currentPort();
		const previousPassword = this.#connection?.password;
		await this.#stop();
		return this.#startOnce(previousPort, previousPassword);
	}

	/** Port of the running connection, if any, parsed from its baseUrl. */
	#currentPort(): number | undefined {
		if (!this.#connection) return undefined;
		const port = Number.parseInt(new URL(this.#connection.baseUrl).port, 10);
		return Number.isInteger(port) && port > 0 ? port : undefined;
	}

	/**
	 * Start the server once, reusing `preferredPort` and `preferredPassword` when
	 * provided. If a start that requested a preferred port fails for any reason,
	 * retry once on an OS-assigned port with fresh credentials so a restart can
	 * never get wedged on an unavailable port. A non-port failure (version
	 * mismatch, broken binary) simply fails again on the retry rather than being
	 * masked, and the retry log does not claim the cause was port-specific.
	 */
	#startOnce(preferredPort?: number, preferredPassword?: string): Promise<KiloServerConnection> {
		if (this.#connection) return Promise.resolve(this.#publicConnection(this.#connection));
		if (this.#startPromise) return this.#startPromise;

		this.#startPromise = this.#start(preferredPort, preferredPassword)
			.catch(async (error) => {
				if (preferredPort === undefined || this.#disposed) throw error;
				this.#options.logger.warn(
					`Kilo server failed to start on preferred port ${preferredPort}; retrying once on a new OS-assigned port.`,
				);
				await this.#stop();
				return this.#start();
			})
			.finally(() => {
				this.#startPromise = undefined;
			});
		return this.#startPromise;
	}

	/** Stops the server (after any start in progress) but, unlike `dispose`, allows starting again. */
	async stop(): Promise<void> {
		if (this.#startPromise) await this.#startPromise.catch(() => undefined);
		await this.#stop();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#connection = undefined;
		this.#setStatus({ status: "stopped" });
		void this.#stop();
	}

	async #start(preferredPort?: number, preferredPassword?: string): Promise<KiloServerConnection> {
		this.#setStatus({ status: "starting" });
		const password = preferredPassword ?? randomBytes(32).toString("hex");
		const authHeader = `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}`;
		let child: KiloChildProcess | undefined;
		let stderrCollector: StderrCollector | undefined;
		try {
			await this.#ensureRuntimeDirectory();
			const configContent = await this.#inlineConfigContent();
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			const environment = this.#createEnvironment(password, configContent);
			const args = [
				"serve",
				"--hostname=127.0.0.1",
				`--port=${preferredPort ?? 0}`,
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
			stderrCollector = child.stderr ? new StderrCollector(child.stderr) : undefined;
			if (!stderrCollector) child.stderr?.resume();

			const baseUrl = await this.#waitForListeningUrl(child);
			// Server is listening — stderr is no longer needed for diagnostics.
			stderrCollector?.stop();
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
			// The preference may have changed after this process read its spawn env.
			void this.#syncTelemetry().catch((error) =>
				this.#options.logger.warn(
					`Could not sync telemetry preference: ${safeErrorMessage(error, [password, authHeader])}`,
				),
			);
			this.#options.logger.info(`Ready at ${baseUrl} (version ${version}).`);
			return this.#publicConnection(connection);
		} catch (error) {
			stderrCollector?.stop();
			if (child) await this.#terminate(child);
			const stderrOutput = redactSecrets(stderrCollector?.text() ?? "", [password, authHeader]);
			const internalMessage = safeErrorMessage(error, [password, authHeader]);
			const publicMessage =
				error instanceof KiloOperationalError ? internalMessage : GENERIC_STARTUP_ERROR;
			this.#connection = undefined;
			if (this.#disposed) {
				this.#setStatus({ status: "stopped" });
				throw new KernelError("BUSINESS", "Kilo Code has shut down.");
			}
			this.#setStatus({
				status: "error",
				message: publicMessage,
				...(stderrOutput ? { detail: stderrOutput } : {}),
			});
			if (stderrOutput) this.#options.logger.error(stderrOutput);
			this.#options.logger.error(internalMessage);
			throw new KernelError("BUSINESS", appendStderrContext(publicMessage, stderrOutput));
		}
	}

	/**
	 * Ensures the stable cwd, app-owned XDG config profile, and app-local state
	 * root exist. Kilo's data/cache roots remain inherited so provider credentials
	 * and sessions still match Kilo CLI / VS Code.
	 */
	async #ensureRuntimeDirectory(): Promise<void> {
		await Promise.all([
			mkdir(this.#options.runtimeDirectory, { recursive: true }),
			mkdir(this.#options.configDirectory, { recursive: true }),
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

	// Mirrors the CLI's default; an injected KILO_API_URL (the e2e stub) steers it.
	#kiloBaseUrl(): string {
		return this.#options.environment.KILO_API_URL ?? DEFAULT_KILO_GATEWAY_ORIGIN;
	}

	async #inlineConfigContent(): Promise<string> {
		const files = await listManagedKiloPluginFiles(this.#options.managedPluginDirectory);
		return kiloInlineConfigContent(files, this.#kiloBaseUrl());
	}

	#createEnvironment(password: string, configContent: string): NodeJS.ProcessEnv {
		const contributed = this.#contributedEnv ? this.#contributedEnv.getMergedEnv() : {};
		const sanitizedContributed = this.#sanitizeContributedEnv(contributed);
		const inheritedXdgConfigHome =
			this.#options.environment.XDG_CONFIG_HOME ??
			Object.entries(this.#options.environment).find(
				([name, value]) => name.toUpperCase() === "XDG_CONFIG_HOME" && value !== undefined,
			)?.[1];
		// Snapshot for drift detection; a subsequent env change that matches
		// this snapshot won't trigger a restart.
		this.#lastSpawnedContributedEnv = { ...sanitizedContributed };

		const environment: NodeJS.ProcessEnv = {
			...this.#options.environment,
			...sanitizedContributed,
			KILO_SERVER_PASSWORD: password,
			KILO_PARENT_PID: String(process.pid),
			// Telemetry attribution: without these the CLI reports itself as a bare
			// `kilo-cli` on the host OS, making Desktop-spawned events
			// indistinguishable from terminal usage in PostHog. Set after the
			// spreads so inherited shell values cannot override attribution.
			KILO_APP_NAME: "kilo-desktop",
			KILO_PLATFORM: "desktop",
			KILO_TELEMETRY_LEVEL: this.#telemetryEnabled ? "all" : "off",
			// Anonymous identity attribution: the CLI's Identity takes
			// KILO_MACHINE_ID over its own persisted telemetry-id, so Desktop's
			// installation id becomes the CLI's anonymous PostHog distinct_id
			// and the X-KILOCODE-MACHINEID gateway header. Set after the spreads
			// so inherited shell values cannot override it.
			...(this.#options.installationId ? { KILO_MACHINE_ID: this.#options.installationId } : {}),
			// Kilo Gateway usage attribution: the CLI forwards this as the
			// X-KILOCODE-FEATURE header. Must match a value in the gateway's
			// FEATURE_VALUES enum (Kilo-Org/cloud feature-detection.ts) or the
			// gateway drops it to NULL.
			KILOCODE_FEATURE: "desktop",
			// Covers the CLI's env-default paths; the pinned config also sets it.
			KILO_API_URL: this.#kiloBaseUrl(),
			KILO_ENABLE_QUESTION_TOOL: "true",
			KILO_EXPERIMENTAL_MCP_APPS: "true",
			KILO_TREE_SITTER_WASM_DIR: this.#options.installation.treeSitterWasmDirectory,
			// Merge Desktop's built-in config on top of the user's global Kilo config.
			KILO_CONFIG_DIR: this.#options.configDirectory,
			...(inheritedXdgConfigHome === undefined ? {} : { XDG_CONFIG_HOME: inheritedXdgConfigHome }),
			// Match OpenCode desktop: isolate state under Electron storage.
			XDG_STATE_HOME: this.#options.environment.XDG_STATE_HOME ?? this.#options.stateDirectory,
			NO_PROXY: appendNoProxy(this.#options.environment.NO_PROXY),
			no_proxy: appendNoProxy(this.#options.environment.no_proxy),
		};
		const webMcpEndpoint = this.#options.webMcpEndpoint?.();
		this.#lastSpawnedWebMcpEndpoint = webMcpEndpoint;
		// Case-insensitive scrub of dangerous keys, in case any case-variant
		// survived the spread from process.env. KILO_MACHINE_ID is deleted
		// outright when this app has no installation id to stamp, so an
		// inherited value can never leak through to the CLI.
		for (const name of Object.keys(environment)) {
			const upper = name.toUpperCase();
			if (
				(upper === "KILO_TELEMETRY_LEVEL" && name !== "KILO_TELEMETRY_LEVEL") ||
				(upper === "KILO_MACHINE_ID" &&
					(name !== "KILO_MACHINE_ID" || this.#options.installationId === undefined))
			) {
				delete environment[name];
				continue;
			}
			if (upper === "KILO_CONFIG_CONTENT") {
				delete environment[name];
				continue;
			}
			if (upper === "KILO_CONFIG_DIR") {
				// Keep our explicitly-set KILO_CONFIG_DIR; remove any inherited or
				// case-variant entry that leaked through the process.env spread.
				if (name !== "KILO_CONFIG_DIR") delete environment[name];
				continue;
			}
			if (upper === "XDG_CONFIG_HOME" && name !== "XDG_CONFIG_HOME") {
				delete environment[name];
				continue;
			}
			if (upper === "NODE_OPTIONS" || upper === "ELECTRON_RUN_AS_NODE") {
				delete environment[name];
				continue;
			}
			if (INHERITED_KILO_CREDENTIAL_ENV.has(upper)) {
				delete environment[name];
				continue;
			}
			// Only Desktop's own endpoint may be named here; an inherited value
			// would point Kilo's `mcp.desktop` entry somewhere else.
			if (upper === WEBMCP_ENDPOINT_URL_ENV || upper === WEBMCP_ENDPOINT_TOKEN_ENV) {
				delete environment[name];
			}
		}
		if (webMcpEndpoint) {
			environment[WEBMCP_ENDPOINT_URL_ENV] = webMcpEndpoint.url;
			environment[WEBMCP_ENDPOINT_TOKEN_ENV] = webMcpEndpoint.token;
		}
		// Desktop's inline config replaces any inherited value, so the only
		// inline layer Kilo sees is the one Desktop owns.
		if (configContent) environment.KILO_CONFIG_CONTENT = configContent;
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
		for (;;) {
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

	/** Emits only real transitions; listeners get a copy they may mutate. */
	#setStatus(status: KiloServerStatus): void {
		if (isEqual(status, this.#status)) return;
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
