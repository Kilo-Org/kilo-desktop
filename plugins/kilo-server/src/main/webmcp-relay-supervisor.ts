import { createConnection } from "node:net";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

import { execa } from "execa";

import type { KiloLogger } from "./KiloServerManager.js";
import {
	buildWebMcpRelayArgv,
	WEBMCP_RELAY_ID,
	WEBMCP_RELAY_LABEL,
	WEBMCP_RELAY_PORT,
} from "./seed-kilo-mcp-config.js";
import { resolveWebMcpRelayEntry } from "./webmcp-relay-entry.js";

/**
 * Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102.
 *
 * Owns the WebMCP rendezvous on loopback `:9345` from Desktop main, independent
 * of kilo's lazy MCP connect. The widget's first discovery scan can hit a live
 * port; when kilo later spawns its `mcp["anaconda-desktop-relay"]` child, that
 * process joins this server in client mode and proxies tools over stdio.
 */

const DEFAULT_READY_TIMEOUT_MS = 90_000;
const DEFAULT_READY_POLL_MS = 250;
const DEFAULT_RESTART_DELAY_MS = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface WebMcpRelayChildProcess {
	readonly pid?: number;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	readonly exitCode: number | null;
	kill(signal?: NodeJS.Signals | number): boolean;
	on: EventEmitter["on"];
	once: EventEmitter["once"];
	off: EventEmitter["off"];
}

export interface WebMcpRelaySupervisorOptions {
	readonly appExecutablePath: string;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly port?: number;
	readonly relayId?: string;
	readonly label?: string;
	readonly readyTimeoutMs?: number;
	readonly readyPollMs?: number;
	readonly restartDelayMs?: number;
	readonly shutdownTimeoutMs?: number;
	readonly resolveRelay?: () => { entry: string; version: string };
	readonly spawn?: (
		executablePath: string,
		args: readonly string[],
		options: { env: NodeJS.ProcessEnv },
	) => WebMcpRelayChildProcess;
	readonly waitForPort?: (port: number, host: string, timeoutMs: number) => Promise<void>;
	readonly signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

export interface WebMcpRelaySupervisorHandle {
	/** Resolves `true` when the rendezvous port is accepting connections. */
	start(): Promise<boolean>;
	dispose(): void;
}

function defaultSpawn(
	executablePath: string,
	args: readonly string[],
	options: { env: NodeJS.ProcessEnv },
): WebMcpRelayChildProcess {
	return execa(executablePath, args, {
		...options,
		buffer: false,
		reject: false,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	}) as unknown as WebMcpRelayChildProcess;
}

function defaultSignalProcess(pid: number, signal: NodeJS.Signals): void {
	process.kill(pid, signal);
}

/**
 * TCP probe — enough to know the relay (or a compatible peer) is listening.
 */
export function waitForTcpPort(
	port: number,
	host: string,
	timeoutMs: number,
	pollMs = DEFAULT_READY_POLL_MS,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		const attempt = (): void => {
			const socket = createConnection({ port, host });
			const onError = (): void => {
				socket.destroy();
				if (Date.now() >= deadline) {
					reject(new Error(`Timed out waiting for ${host}:${port} after ${timeoutMs}ms.`));
					return;
				}
				setTimeout(attempt, pollMs);
			};
			socket.once("connect", () => {
				socket.end();
				socket.destroy();
				resolve();
			});
			socket.once("error", onError);
		};
		attempt();
	});
}

/**
 * Builds the argv shared by the main-owned rendezvous and kilo's MCP overlay.
 * Re-exported from {@link buildWebMcpRelayArgv} in seed-kilo-mcp-config for
 * callers that already import the supervisor module.
 */
export { buildWebMcpRelayArgv } from "./seed-kilo-mcp-config.js";

/**
 * Supervises a long-lived WebMCP local-relay process that owns the WS
 * rendezvous port for the Desktop renderer.
 */
export class WebMcpRelaySupervisor implements WebMcpRelaySupervisorHandle {
	readonly #options: Required<
		Pick<
			WebMcpRelaySupervisorOptions,
			| "appExecutablePath"
			| "port"
			| "relayId"
			| "label"
			| "readyTimeoutMs"
			| "readyPollMs"
			| "restartDelayMs"
			| "shutdownTimeoutMs"
		>
	> &
		WebMcpRelaySupervisorOptions;

	#child: WebMcpRelayChildProcess | undefined;
	#disposed = false;
	#starting: Promise<boolean> | undefined;
	#restartTimer: ReturnType<typeof setTimeout> | undefined;
	#intentionalExit = false;

	constructor(options: WebMcpRelaySupervisorOptions) {
		this.#options = {
			port: WEBMCP_RELAY_PORT,
			relayId: WEBMCP_RELAY_ID,
			label: WEBMCP_RELAY_LABEL,
			readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
			readyPollMs: DEFAULT_READY_POLL_MS,
			restartDelayMs: DEFAULT_RESTART_DELAY_MS,
			shutdownTimeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
			...options,
		};
	}

	start(): Promise<boolean> {
		if (this.#disposed) return Promise.resolve(false);
		if (this.#starting) return this.#starting;
		this.#starting = this.#startOnce().finally(() => {
			this.#starting = undefined;
		});
		return this.#starting;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#restartTimer) {
			clearTimeout(this.#restartTimer);
			this.#restartTimer = undefined;
		}
		const child = this.#child;
		this.#child = undefined;
		if (!child) return;
		this.#intentionalExit = true;
		void this.#terminate(child);
	}

	async #startOnce(): Promise<boolean> {
		if (this.#disposed) return false;
		const logger = this.#options.logger;
		const resolveRelay = this.#options.resolveRelay ?? resolveWebMcpRelayEntry;
		const spawn = this.#options.spawn ?? defaultSpawn;
		const waitForPort = this.#options.waitForPort ?? waitForTcpPort;

		let relay: { entry: string; version: string };
		try {
			relay = resolveRelay();
		} catch (error) {
			logger?.warn(
				`WebMCP rendezvous not started: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}

		const argv = buildWebMcpRelayArgv(relay.entry, {
			port: this.#options.port,
			relayId: this.#options.relayId,
			label: this.#options.label,
		});

		try {
			this.#intentionalExit = false;
			const child = spawn(this.#options.appExecutablePath, argv, {
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
				},
			});
			if (!child.pid) {
				logger?.warn("WebMCP rendezvous spawn did not provide a process id.");
				return false;
			}
			this.#child = child;
			// Drain pipes so a chatty MCP/stdio side cannot stall the process.
			child.stdout?.resume();
			child.stderr?.resume();
			child.once("exit", (code, signal) => {
				this.#onChildExit(code, signal);
			});

			await waitForPort(this.#options.port, "127.0.0.1", this.#options.readyTimeoutMs);
			if (this.#disposed) {
				this.#intentionalExit = true;
				void this.#terminate(child);
				return false;
			}
			logger?.info(
				`WebMCP rendezvous listening on 127.0.0.1:${this.#options.port} (@mcp-b/webmcp-local-relay@${relay.version}).`,
			);
			return true;
		} catch (error) {
			logger?.warn(
				`WebMCP rendezvous failed to become ready: ${error instanceof Error ? error.message : String(error)}`,
			);
			const child = this.#child;
			this.#child = undefined;
			if (child) {
				this.#intentionalExit = true;
				void this.#terminate(child);
			}
			return false;
		}
	}

	#onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
		this.#child = undefined;
		if (this.#disposed || this.#intentionalExit) return;
		const logger = this.#options.logger;
		logger?.warn(
			`WebMCP rendezvous exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "null"}); restarting.`,
		);
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			if (this.#disposed) return;
			void this.start();
		}, this.#options.restartDelayMs);
	}

	async #terminate(child: WebMcpRelayChildProcess): Promise<void> {
		if (child.exitCode !== null) return;
		const signalProcess = this.#options.signalProcess ?? defaultSignalProcess;
		const pid = child.pid;
		try {
			if (pid) signalProcess(pid, "SIGTERM");
			else child.kill("SIGTERM");
		} catch {
			child.kill("SIGTERM");
		}
		const exited = await this.#waitForExit(child, this.#options.shutdownTimeoutMs);
		if (exited) return;
		try {
			if (pid) signalProcess(pid, "SIGKILL");
			else child.kill("SIGKILL");
		} catch (error) {
			this.#options.logger?.warn(
				`Failed to force-stop WebMCP rendezvous: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	#waitForExit(child: WebMcpRelayChildProcess, timeoutMs: number): Promise<boolean> {
		if (child.exitCode !== null) return Promise.resolve(true);
		return new Promise((resolve) => {
			const onExit = (): void => {
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				child.off("exit", onExit);
				resolve(false);
			}, timeoutMs);
			child.once("exit", onExit);
		});
	}
}
