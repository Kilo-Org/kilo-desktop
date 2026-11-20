import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { promisify, stripVTControlCharacters } from "node:util";

import { KernelError } from "@kilo-desktop/kernel";
import { OpenCode } from "@kilocode/client";
import { execa } from "execa";
import isEqual from "lodash/isEqual.js";

import type { KiloServerConnection, KiloServerStatus } from "./types.js";
import { KILO_CLI_VERSION } from "./cli-distribution/artifacts.js";
import type { ContributedEnvManager } from "./ContributedEnvManager.js";
import { kiloInlineConfigContent } from "./kilo-inline-config.js";
import { WEBMCP_ENDPOINT_TOKEN_ENV, WEBMCP_ENDPOINT_URL_ENV } from "./webmcp-relay-config.js";

const execFile = promisify(execFileCallback);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const GENERIC_STARTUP_ERROR = "Kilo server failed to start.";

/** Kilo v2's Basic auth user; the password is generated per launch. */
const SERVER_USERNAME = "opencode";

/**
 * Dropped from the inherited env (case-insensitively) and never set by
 * Desktop unless listed in `#createEnvironment`:
 *
 * - `KILO_API_KEY`: the host shell must not hand the CLI a Kilo credential;
 * - server passwords: `OPENCODE_PASSWORD` is Desktop's own; `serve --stdio`
 *   removes only the two `OPENCODE_*` names before tools start, so an
 *   inherited `KILO_SERVER_PASSWORD` (translated to
 *   `OPENCODE_SERVER_PASSWORD`) would reach every tool;
 * - storage pointers: `KILO2_CONFIG`, `KILO2_CONFIG_DIR`, `KILO2_DB` and
 *   their `OPENCODE_*` targets would move Kilo onto other config or data;
 * - inline config: only Desktop's `KILO_CONFIG_CONTENT` may reach Kilo;
 * - v1-only names, which v2 ignores, so nothing reads a stale value.
 */
const SCRUBBED_ENV = new Set([
	"KILO_API_KEY",
	"OPENCODE_PASSWORD",
	"OPENCODE_SERVER_PASSWORD",
	"KILO_SERVER_PASSWORD",
	"KILO2_CONFIG",
	"KILO2_CONFIG_DIR",
	"KILO2_DB",
	"OPENCODE_CONFIG",
	"OPENCODE_CONFIG_DIR",
	"OPENCODE_DB",
	"KILO_CONFIG_CONTENT",
	"OPENCODE_CONFIG_CONTENT",
	"KILO_CONFIG_DIR",
	"KILO_PARENT_PID",
	"KILO_APP_NAME",
	"KILO_TELEMETRY_LEVEL",
	"KILO_ENABLE_QUESTION_TOOL",
	"KILO_EXPERIMENTAL_MCP_APPS",
	"OPENCODE_CLIENT",
]);

// The CLI's own default gateway origin, used when nothing injects KILO_API_URL.
const DEFAULT_KILO_GATEWAY_ORIGIN = "https://api.kilo.ai";

class KiloOperationalError extends Error {}

export interface KiloInstallation {
	readonly executablePath: string;
	readonly treeSitterWasmDirectory: string;
	/** A developer's own CLI (`KILO_CODE_CLI_PATH`), which may be any version. */
	readonly custom?: boolean;
}

export interface KiloChildProcess {
	readonly pid?: number;
	/** `serve --stdio` runs until this closes. */
	readonly stdin: Writable | null;
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
	 * App-owned Kilo v2 config directory passed as `KILO2_CONFIG_DIR`. Kilo
	 * merges it additively on top of the user's global config.
	 */
	readonly configDirectory: string;
	/** App-local XDG state root. Honors an inherited `XDG_STATE_HOME`. */
	readonly stateDirectory: string;
	/**
	 * Desktop's stable installation id, stamped as `KILO_MACHINE_ID` at every
	 * spawn so the CLI sends the app's anonymous identity as its
	 * `X-KILOCODE-MACHINEID` gateway header instead of generating its own
	 * `telemetry-id`.
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
		stdin: "pipe",
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

/** The URL in `serve --stdio`'s JSON `{"url": …}` line; any other line is not it. */
function listeningUrlOf(line: string): string | undefined {
	const text = line.trim();
	if (!text.startsWith("{")) return undefined;
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null || !("url" in value)) return undefined;
		return typeof value.url === "string" ? value.url : undefined;
	} catch {
		return undefined;
	}
}

/** `@kilocode/client` reports a 401 as an error tagged `UnauthorizedError`. */
function isUnauthorized(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"_tag" in error &&
		error._tag === "UnauthorizedError"
	);
}

/**
 * Owns the lifecycle of Desktop's own Kilo v2 server, `kilo2 serve --stdio`:
 * spawn, wait for the JSON `{url}` line it prints and for `/api/info` (read
 * through `@kilocode/client`) to answer with this launch's credentials, expose
 * the connection to consumers, and tear the child down on `dispose()`.
 * Restarts are serialized so a rapid restart storm coalesces into one graceful
 * stop + one fresh spawn, matching the "one server per Desktop process"
 * invariant.
 *
 * **Lifetime.** `serve --stdio` exits when its stdin closes, so the open stdin
 * pipe is the process lifetime: stopping closes it, and if Desktop dies the
 * pipe closes with it. Signals to the process group are only the fallback for
 * a child that doesn't exit in time. v2 has no parent-PID watchdog.
 *
 * **Version policy.** The bundled `kilo2` is pinned exactly
 * (`KILO_CLI_VERSION`); a server reporting another version fails to start. A
 * developer's own CLI (`KILO_CODE_CLI_PATH`) may be any version.
 *
 * **Telemetry.** Kilo v2 has no telemetry sink yet, and no setting or route to
 * turn one off, so Desktop's data-collection preference has nothing to reach
 * in the server; `setTelemetryEnabled` only records it.
 *
 * **Status emission contract.** `#setStatus` is gated by `isEqual`, so
 * callers observe exactly one `onStatusChange` per REAL transition. That means
 * structurally-identical consecutive writes are intentionally not re-emitted
 * — most visibly `stopped → stopped` on `dispose()` when the manager was
 * never started, and `error → error` when a mid-startup failure runs the
 * "stopped" branch after `dispose()` already emitted it. Subscribers that
 * need a periodic resync must use a separate signal (the boot progress
 * channel or an explicit refresh IPC), not the status event stream.
 *
 * `#createEnvironment` scrubs inherited credentials, passwords and storage
 * pointers (`SCRUBBED_ENV`) and passes Desktop's own `KILO_CONFIG_CONTENT`
 * (`kilo-inline-config.ts`), which makes archive commands ask, so project
 * config cannot undo it.
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
		>
	> &
		Pick<
			KiloServerManagerOptions,
			"installation" | "runtimeDirectory" | "configDirectory" | "stateDirectory" | "corsOrigins"
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
		};
		this.#contributedEnv = options.contributedEnv;
	}

	get status(): KiloServerStatus {
		return structuredClone(this.#status);
	}

	get isRunning(): boolean {
		return this.#connection !== undefined;
	}

	/** Kilo v2 has no telemetry to switch, so Desktop's preference stops here. */
	setTelemetryEnabled(_enabled: boolean): Promise<void> {
		return Promise.resolve();
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
		const authHeader = `Basic ${Buffer.from(`${SERVER_USERNAME}:${password}`).toString("base64")}`;
		let child: KiloChildProcess | undefined;
		let stderrCollector: StderrCollector | undefined;
		try {
			await this.#ensureRuntimeDirectory();
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			const environment = this.#createEnvironment(password, kiloInlineConfigContent());
			const args = [
				"serve",
				"--hostname",
				"127.0.0.1",
				"--port",
				String(preferredPort ?? 0),
				"--stdio",
				...this.#options.corsOrigins.flatMap((origin) => ["--cors", origin]),
			];
			const spawnedAt = performance.now();
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
			const listeningAt = performance.now();
			// Server is listening — stderr is no longer needed for diagnostics.
			stderrCollector?.stop();
			const version = await this.#waitForHealthy(baseUrl, authHeader);
			const healthyAt = performance.now();
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			const versionPinned =
				!this.#options.allowVersionMismatch && !this.#options.installation.custom;
			if (versionPinned && version !== this.#options.expectedVersion) {
				throw new KiloOperationalError(
					`Kilo server version mismatch: expected ${this.#options.expectedVersion}, got ${version}.`,
				);
			}

			const connection = {
				baseUrl,
				username: SERVER_USERNAME,
				password,
				version,
				globalDirectory: this.#options.runtimeDirectory,
				pid: child.pid,
			};
			this.#connection = connection;
			this.#setStatus({ status: "ready", baseUrl, version });
			this.#options.logger.info(
				`Ready at ${baseUrl} (version ${version}): listening ${Math.round(listeningAt - spawnedAt)} ms after spawn, healthy ${Math.round(healthyAt - listeningAt)} ms later; ${Math.round(healthyAt)} ms after launch.`,
			);
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
	 * Ensures the stable cwd, app-owned Kilo v2 config directory, and app-local
	 * state root exist. Kilo v2's data/cache roots (`<XDG base>/kilo2`) remain
	 * inherited, so credentials and sessions match the user's own `kilo2` CLI
	 * and never touch v1's `kilo` folders.
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
	 *   and Electron-as-Node (`ELECTRON_RUN_AS_NODE`).
	 *
	 * - **Prefix:** whole namespaces we reserve to Kilo (`KILO_`, `KILO2_`, and
	 *   `OPENCODE_`, which Kilo v2's runtime reads, the per-launch password
	 *   included) and the XDG spec (`XDG_`), plus the macOS dynamic linker
	 *   family (`DYLD_`) and Linux loader-preload family (`LD_`). Reserving
	 *   prefixes prevents a contributor from shipping a future variant we
	 *   haven't enumerated (e.g. `DYLD_FALLBACK_LIBRARY_PATH`, a new `KILO_*`
	 *   knob).
	 */
	static readonly #RESERVED_EXACT_UPPER = new Set([
		"PATH",
		"NO_PROXY",
		"NODE_OPTIONS",
		"ELECTRON_RUN_AS_NODE",
	]);

	static readonly #RESERVED_PREFIXES_UPPER = [
		"KILO_",
		"KILO2_",
		"OPENCODE_",
		"XDG_",
		"DYLD_",
		"LD_",
	] as const;

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
		};
		// Case-insensitive scrub, so no case variant of a name Desktop owns
		// survives the spreads; Desktop's own values are set below.
		for (const name of Object.keys(environment)) {
			const upper = name.toUpperCase();
			if (
				SCRUBBED_ENV.has(upper) ||
				upper === "KILO_MACHINE_ID" ||
				upper === "NODE_OPTIONS" ||
				upper === "ELECTRON_RUN_AS_NODE" ||
				upper === WEBMCP_ENDPOINT_URL_ENV ||
				upper === WEBMCP_ENDPOINT_TOKEN_ENV ||
				(upper === "XDG_CONFIG_HOME" && name !== "XDG_CONFIG_HOME")
			) {
				delete environment[name];
			}
		}
		Object.assign(environment, {
			// Removed from the server's own environment before tools start.
			OPENCODE_PASSWORD: password,
			// Attribution: the server's app name, the gateway's platform and
			// X-KILOCODE-FEATURE (a value of the gateway's FEATURE_VALUES enum in
			// Kilo-Org/cloud, or the gateway drops it to NULL). Set after the
			// spreads so inherited shell values cannot override them.
			KILO_CLIENT: "kilo-desktop",
			KILO_PLATFORM: "desktop",
			KILOCODE_FEATURE: "desktop",
			// Covers the CLI's env-default gateway and indexing paths.
			KILO_API_URL: this.#kiloBaseUrl(),
			KILO_TREE_SITTER_WASM_DIR: this.#options.installation.treeSitterWasmDirectory,
			// Merge Desktop's built-in config on top of the user's global Kilo config.
			KILO2_CONFIG_DIR: this.#options.configDirectory,
			// Desktop's inline config is the only inline layer Kilo sees.
			KILO_CONFIG_CONTENT: configContent,
			// Match OpenCode desktop: isolate state under Electron storage.
			XDG_STATE_HOME: this.#options.environment.XDG_STATE_HOME ?? this.#options.stateDirectory,
			NO_PROXY: appendNoProxy(this.#options.environment.NO_PROXY),
			no_proxy: appendNoProxy(this.#options.environment.no_proxy),
		});
		if (inheritedXdgConfigHome !== undefined) environment.XDG_CONFIG_HOME = inheritedXdgConfigHome;
		// Anonymous identity: the CLI takes KILO_MACHINE_ID over its own
		// persisted telemetry-id for the X-KILOCODE-MACHINEID gateway header.
		// Without an installation id no inherited value may stand in for it.
		if (this.#options.installationId) {
			environment.KILO_MACHINE_ID = this.#options.installationId;
		}
		// Only Desktop's own endpoint may be named here; an inherited value
		// would point Kilo's `mcp.desktop` entry somewhere else.
		const webMcpEndpoint = this.#options.webMcpEndpoint?.();
		this.#lastSpawnedWebMcpEndpoint = webMcpEndpoint;
		if (webMcpEndpoint) {
			environment[WEBMCP_ENDPOINT_URL_ENV] = webMcpEndpoint.url;
			environment[WEBMCP_ENDPOINT_TOKEN_ENV] = webMcpEndpoint.token;
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
				const printed = listeningUrlOf(line);
				if (printed === undefined) return;
				try {
					const url = new URL(printed);
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

	/**
	 * Reads `/api/info` through `@kilocode/client` until it answers, and returns
	 * the server's version. It answers 503 while booting; a 401 means the
	 * server isn't the one spawned with this launch's password.
	 */
	async #waitForHealthy(baseUrl: string, authorization: string): Promise<string> {
		const client = OpenCode.make({
			baseUrl,
			headers: { authorization },
			// The client passes URL objects; Electron's net.fetch takes a string or Request.
			fetch: (input, init) => this.#options.fetch(input instanceof URL ? input.href : input, init),
		});
		const deadline = Date.now() + this.#options.healthTimeoutMs;
		let lastError: unknown = new Error("no answer");
		for (;;) {
			try {
				const info = await client.server.info({
					signal: AbortSignal.timeout(this.#options.healthRequestTimeoutMs),
				});
				if (typeof info.version !== "string" || !info.version) {
					throw new KiloOperationalError("Kilo server returned an invalid info response.");
				}
				return info.version;
			} catch (error) {
				if (isUnauthorized(error)) {
					throw new KiloOperationalError("Kilo server rejected its per-launch credentials.");
				}
				if (error instanceof KiloOperationalError) throw error;
				lastError = error;
			}
			if (Date.now() >= deadline) break;
			await delay(this.#options.healthRetryDelayMs);
		}
		throw new KiloOperationalError(
			`Kilo server did not answer its health check: ${safeErrorMessage(lastError)}`,
		);
	}

	async #stop(): Promise<void> {
		const child = this.#child;
		this.#child = undefined;
		this.#connection = undefined;
		if (!child) return;
		await this.#terminate(child);
		if (!this.#disposed) this.#setStatus({ status: "stopped" });
	}

	/**
	 * Closes the child's stdin, which ends `serve --stdio`; signals the process
	 * group only when it doesn't exit within the shutdown timeout, then kills
	 * it after a second one.
	 */
	async #terminate(child: KiloChildProcess): Promise<void> {
		this.#intentionalExits.add(child);
		if (child.exitCode !== null) return;
		child.stdin?.end();
		if (await this.#waitForExit(child, this.#options.shutdownTimeoutMs)) return;
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
