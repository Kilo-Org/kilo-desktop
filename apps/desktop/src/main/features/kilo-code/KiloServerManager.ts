import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import path from "node:path";
import { promisify } from "node:util";

import type { KiloServerConnection, KiloServerStatus } from "@anaconda-agentic-desktop/contracts";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";
import { net } from "electron";
import { execa } from "execa";

import { createLogger } from "../../platform/logger.js";
import { KILO_CLI_VERSION } from "./cli-distribution/artifacts.js";

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
	readonly expectedVersion?: string;
	readonly allowVersionMismatch?: boolean;
	readonly corsOrigins?: readonly string[];
	readonly environment?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
	readonly fetch?: typeof fetch;
	readonly spawn?: (
		executablePath: string,
		args: readonly string[],
		options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv },
	) => KiloChildProcess;
	readonly signalProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
	readonly killWindowsTree?: (pid: number) => Promise<void>;
	readonly onStatusChange?: (status: KiloServerStatus) => void;
	readonly logger?: KiloLogger;
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
		Pick<KiloServerManagerOptions, "installation" | "runtimeDirectory">;
	readonly #intentionalExits = new WeakSet<KiloChildProcess>();
	#status: KiloServerStatus = { status: "stopped" };
	#child: KiloChildProcess | undefined;
	#connection: (KiloServerConnection & { pid: number }) | undefined;
	#startPromise: Promise<KiloServerConnection> | undefined;
	#disposed = false;

	constructor(options: KiloServerManagerOptions) {
		this.#options = {
			installation: options.installation,
			runtimeDirectory: options.runtimeDirectory,
			expectedVersion: options.expectedVersion ?? KILO_CLI_VERSION,
			allowVersionMismatch: options.allowVersionMismatch ?? false,
			corsOrigins: options.corsOrigins ?? DEFAULT_CORS_ORIGINS,
			environment: options.environment ?? process.env,
			platform: options.platform ?? process.platform,
			fetch:
				options.fetch ??
				((input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)),
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
			logger: options.logger ?? createLogger("kilo-code"),
			startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
			healthTimeoutMs: options.healthTimeoutMs ?? 10_000,
			healthRequestTimeoutMs: options.healthRequestTimeoutMs ?? 3_000,
			healthRetryDelayMs: options.healthRetryDelayMs ?? 250,
			shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
		};
	}

	get status(): KiloServerStatus {
		return structuredClone(this.#status);
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
			const directories = await this.#prepareRuntimeDirectories();
			if (this.#disposed) throw new Error("Kilo Code has shut down.");
			const environment = this.#createEnvironment(password, directories);
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

			const connection = { baseUrl, username: "kilo", password, version, pid: child.pid };
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

	async #prepareRuntimeDirectories(): Promise<{
		config: string;
		data: string;
		cache: string;
		state: string;
	}> {
		const directories = {
			config: path.join(this.#options.runtimeDirectory, "config"),
			data: path.join(this.#options.runtimeDirectory, "data"),
			cache: path.join(this.#options.runtimeDirectory, "cache"),
			state: path.join(this.#options.runtimeDirectory, "state"),
		};
		await Promise.all(
			[this.#options.runtimeDirectory, ...Object.values(directories)].map((directory) =>
				mkdir(directory, { recursive: true }),
			),
		);
		return directories;
	}

	#createEnvironment(
		password: string,
		directories: { config: string; data: string; cache: string; state: string },
	): NodeJS.ProcessEnv {
		const environment: NodeJS.ProcessEnv = {
			...this.#options.environment,
			KILO_SERVER_PASSWORD: password,
			KILO_PARENT_PID: String(process.pid),
			KILO_ENABLE_QUESTION_TOOL: "true",
			KILO_TREE_SITTER_WASM_DIR: this.#options.installation.treeSitterWasmDirectory,
			XDG_CONFIG_HOME: directories.config,
			XDG_DATA_HOME: directories.data,
			XDG_CACHE_HOME: directories.cache,
			XDG_STATE_HOME: directories.state,
			NO_PROXY: appendNoProxy(this.#options.environment.NO_PROXY),
			no_proxy: appendNoProxy(this.#options.environment.no_proxy),
		};
		delete environment.NODE_OPTIONS;
		delete environment.ELECTRON_RUN_AS_NODE;
		if (this.#options.platform === "linux") delete environment.LD_PRELOAD;
		if (this.#options.platform === "darwin") {
			for (const name of Object.keys(environment)) {
				if (name.startsWith("DYLD_")) delete environment[name];
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
		};
	}
}
