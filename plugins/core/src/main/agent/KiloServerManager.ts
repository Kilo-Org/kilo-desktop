import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { promisify, stripVTControlCharacters } from "node:util";

import { KernelError } from "@kilo-desktop/kernel";
import { execa } from "execa";
import isEqual from "lodash/isEqual.js";

import type { KiloServerConnection, KiloServerStatus } from "./types.js";
import type { ContributedEnvManager } from "./ContributedEnvManager.js";
import { DESKTOP_KILO_CONFIG_FILE } from "./desktop-config-file.js";
import { kiloInlineConfigContent } from "./kilo-inline-config.js";
import { listManagedKiloPlugins } from "./managed-kilo-plugins.js";
import { WEBMCP_ENDPOINT_TOKEN_ENV, WEBMCP_ENDPOINT_URL_ENV } from "./webmcp-relay-config.js";

const execFile = promisify(execFileCallback);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const GENERIC_STARTUP_ERROR = "Kilo server failed to start.";

// Dropped from the inherited env so the host shell can't hand the CLI a Kilo credential.
const INHERITED_KILO_CREDENTIAL_ENV = new Set(["KILO_API_KEY"]);

// The CLI's own default gateway origin, used when nothing injects KILO_API_URL.
const DEFAULT_KILO_GATEWAY_ORIGIN = "https://api.kilo.ai";

/** The HTTP Basic user every Kilo v2 server expects; the password is per launch. */
export const KILO_SERVER_USERNAME = "opencode";

export { DESKTOP_KILO_CONFIG_FILE } from "./desktop-config-file.js";

/** The name Kilo v2 reports for this client (`KILO_CLIENT`); some Kilo plugins gate on it. */
const KILO_CLIENT_NAME = "desktop";

class KiloOperationalError extends Error {}

export interface KiloInstallation {
	readonly executablePath: string;
	readonly treeSitterWasmDirectory: string;
	/** A developer's own CLI (`KILO_CODE_CLI_PATH`), which may be any version. */
	readonly custom?: boolean;
}

export interface KiloChildProcess {
	readonly pid?: number;
	/** Kept open for the server's lifetime: `serve --stdio` exits when it closes. */
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
	 * App-owned Kilo config directory. Its {@link DESKTOP_KILO_CONFIG_FILE} is
	 * passed as `KILO2_CONFIG`, which Kilo layers on top of the user's global
	 * config.
	 */
	readonly configDirectory: string;
	/**
	 * Desktop-owned Kilo plugin directories, passed to Kilo as inline config
	 * (`KILO_CONFIG_CONTENT`) rather than placed in `configDirectory`. See
	 * `managed-kilo-plugins.ts`.
	 */
	readonly managedPluginDirectory: string;
	/** App-local XDG state root. Honors an inherited `XDG_STATE_HOME`. */
	readonly stateDirectory: string;
	/**
	 * Desktop's stable installation id, stamped as `KILO_MACHINE_ID` at every
	 * spawn so Kilo sends the app's anonymous identity as the gateway's
	 * `X-KILOCODE-MACHINEID` header. Mirrors the VS Code host, which passes
	 * `vscode.env.machineId`.
	 */
	readonly installationId?: string;
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
	/** How long a server gets to exit after its stdin closes, before it is signalled. */
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

/**
 * The URL in `serve --stdio`'s handshake, a single JSON line `{"url":"…"}`;
 * undefined for any other output line.
 */
function handshakeUrl(line: string): string | undefined {
	if (!line.trimStart().startsWith("{")) return undefined;
	try {
		const parsed = JSON.parse(line) as { url?: unknown };
		return typeof parsed.url === "string" ? parsed.url : undefined;
	} catch {
		return undefined;
	}
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
 * Owns the lifecycle of the packaged Kilo v2 server, `kilo2 serve --stdio`:
 * spawn, wait for its JSON `{"url"}` handshake and an authenticated
 * `/api/info` probe, expose the connection to consumers, and tear the child
 * down cleanly on `dispose()`. Restarts are serialized so a rapid restart
 * storm coalesces into one graceful stop + one fresh spawn, matching the "one
 * server per Desktop process" invariant.
 *
 * **Lifetime.** The child's stdin stays open while it runs; `serve --stdio`
 * exits when stdin closes, so the server can't outlive Desktop even after a
 * crash. Stopping closes stdin first and only signals the process group when
 * the server hasn't exited within `shutdownTimeoutMs`.
 *
 * **Version.** The binary is the staged `kilo-v2` build, whatever version the
 * lockfile fixed, so there is no exact version pin: a server that answers v2's
 * `/api/info` with a version is compatible. A v1 server fails the probe.
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
 * `#createEnvironment` owns Kilo's environment: it scrubs inherited Kilo
 * credentials and every inherited `OPENCODE_*` / `KILO2_*` variable (they would
 * point Kilo v2 at another config, database or password), and passes Desktop's
 * own `KILO_CONFIG_CONTENT` (`kilo-inline-config.ts`), which pins the
 * embedder origin and makes archive commands ask, so project config cannot
 * undo either.
 */
export class KiloServerManager {
	readonly #options: Required<
		Pick<
			KiloServerManagerOptions,
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
		const authHeader = `Basic ${Buffer.from(`${KILO_SERVER_USERNAME}:${password}`).toString("base64")}`;
		let child: KiloChildProcess | undefined;
		let stderrCollector: StderrCollector | undefined;
		try {
			await this.#ensureRuntimeDirectory();
			const configContent = await this.#inlineConfigContent();
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			const environment = this.#createEnvironment(password, configContent);
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

			const connection = {
				baseUrl,
				username: KILO_SERVER_USERNAME,
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
	 * Ensures the stable cwd, the app-owned config directory, and the app-local
	 * state root exist. Kilo's data/cache roots remain inherited so credentials
	 * and sessions match the Kilo v2 CLI and VS Code.
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
	 *   runtime hooks (`NODE_OPTIONS`) and Electron-as-Node (`ELECTRON_RUN_AS_NODE`).
	 *
	 * - **Prefix:** whole namespaces we reserve to Kilo (`KILO_`, `KILO2_`, and
	 *   upstream's `OPENCODE_`, which Kilo v2 reads), the XDG spec (`XDG_`),
	 *   plus the macOS dynamic linker family (`DYLD_`) and Linux loader-preload
	 *   family (`LD_`). Reserving prefixes prevents a contributor from shipping a
	 *   future variant we haven't enumerated (e.g. `DYLD_FALLBACK_LIBRARY_PATH`,
	 *   a new `KILO_*` knob) and covers Kilo's per-launch identity
	 *   (`KILO_SERVER_PASSWORD`) and resource pointers (`KILO_TREE_SITTER_WASM_DIR`).
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

	/** Variables Kilo v2 reads to find its config, database and password: Desktop owns all of them. */
	static #isKiloV2OwnedEnvKey(key: string): boolean {
		const upper = key.toUpperCase();
		return upper.startsWith("KILO2_") || upper.startsWith("OPENCODE_");
	}

	/** The variables `#createEnvironment` sets, by their exact (upper-case) names. */
	static readonly #OWNED_NAMES = new Set([
		"KILO_SERVER_PASSWORD",
		"KILO_CLIENT",
		"KILO_PLATFORM",
		"KILOCODE_FEATURE",
		"KILO_API_URL",
		"KILO_TREE_SITTER_WASM_DIR",
		"KILO2_CONFIG",
	]);

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
		const plugins = await listManagedKiloPlugins(this.#options.managedPluginDirectory);
		return kiloInlineConfigContent(plugins, this.#kiloBaseUrl());
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
		// Every inherited Kilo v2 / upstream variable goes: they name another
		// config file, config directory, database or server password.
		for (const name of Object.keys(environment)) {
			if (KiloServerManager.#isKiloV2OwnedEnvKey(name)) delete environment[name];
		}
		Object.assign(environment, {
			KILO_SERVER_PASSWORD: password,
			// Attribution: Kilo reports Desktop as its client, and the gateway
			// maps the platform and feature to Desktop's usage. Set after the
			// spreads so inherited shell values cannot override attribution.
			KILO_CLIENT: KILO_CLIENT_NAME,
			KILO_PLATFORM: "desktop",
			// Anonymous identity attribution: Kilo sends KILO_MACHINE_ID as the
			// X-KILOCODE-MACHINEID gateway header. Set after the spreads so
			// inherited shell values cannot override it.
			...(this.#options.installationId ? { KILO_MACHINE_ID: this.#options.installationId } : {}),
			// Kilo Gateway usage attribution: the CLI forwards this as the
			// X-KILOCODE-FEATURE header. Must match a value in the gateway's
			// FEATURE_VALUES enum (Kilo-Org/cloud feature-detection.ts) or the
			// gateway drops it to NULL.
			KILOCODE_FEATURE: "desktop",
			// Covers the CLI's env-default paths; the pinned config also sets it.
			KILO_API_URL: this.#kiloBaseUrl(),
			KILO_TREE_SITTER_WASM_DIR: this.#options.installation.treeSitterWasmDirectory,
			// Layer Desktop's own config file on top of the user's global Kilo config.
			KILO2_CONFIG: path.join(this.#options.configDirectory, DESKTOP_KILO_CONFIG_FILE),
			...(inheritedXdgConfigHome === undefined ? {} : { XDG_CONFIG_HOME: inheritedXdgConfigHome }),
			// Match OpenCode desktop: isolate state under Electron storage.
			XDG_STATE_HOME: this.#options.environment.XDG_STATE_HOME ?? this.#options.stateDirectory,
			NO_PROXY: appendNoProxy(this.#options.environment.NO_PROXY),
			no_proxy: appendNoProxy(this.#options.environment.no_proxy),
		} satisfies NodeJS.ProcessEnv);
		const webMcpEndpoint = this.#options.webMcpEndpoint?.();
		this.#lastSpawnedWebMcpEndpoint = webMcpEndpoint;
		// Case-insensitive scrub of dangerous keys, in case any case-variant
		// survived the spread from process.env. KILO_MACHINE_ID is deleted
		// outright when this app has no installation id to stamp, so an
		// inherited value can never leak through to the CLI.
		for (const name of Object.keys(environment)) {
			const upper = name.toUpperCase();
			if (
				upper === "KILO_MACHINE_ID" &&
				(name !== "KILO_MACHINE_ID" || this.#options.installationId === undefined)
			) {
				delete environment[name];
				continue;
			}
			// Names Desktop sets: only its own spelling survives, so an inherited
			// case variant can't shadow it (Windows env names are case-insensitive).
			if (KiloServerManager.#OWNED_NAMES.has(upper) && name !== upper) {
				delete environment[name];
				continue;
			}
			if (
				upper === "KILO_CONFIG_CONTENT" ||
				upper === "KILO_CONFIG_DIR" ||
				upper === "KILO_CONFIG"
			) {
				// v1's config pointers and any inherited inline config: Desktop's
				// inline config is set below, and v2 ignores v1's pointers.
				delete environment[name];
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
				const reported = handshakeUrl(line);
				if (reported === undefined) return;
				try {
					const url = new URL(reported);
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
				const response = await this.#options.fetch(`${baseUrl}/api/info`, {
					headers: { Authorization: authorization },
					signal: controller.signal,
				});
				if (response.status === 401) {
					throw new KiloOperationalError("Kilo server rejected its per-launch credentials.");
				}
				if (response.ok) {
					const info = (await response.json()) as { version?: unknown };
					if (typeof info.version !== "string" || !info.version) {
						throw new KiloOperationalError("Kilo server returned an invalid info response.");
					}
					return info.version;
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
		// `serve --stdio` shuts down cleanly when its stdin closes.
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
