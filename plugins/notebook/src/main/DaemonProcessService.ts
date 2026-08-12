import { spawn, type ChildProcess } from "node:child_process";

import type { RuntimedLogger } from "./RuntimedService.js";

const READY_POLL_INTERVAL_MS = 150;
const READY_TIMEOUT_MS = 20_000;
const SHUTDOWN_GRACE_MS = 25_000;
const INITIAL_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;
const MAX_RESTART_ATTEMPTS = 5;
const STABLE_UPTIME_MS = 60_000;

export type DaemonState =
	| { readonly status: "idle" }
	| { readonly status: "starting" }
	| { readonly status: "external" }
	| { readonly status: "running"; readonly pid: number }
	| { readonly status: "restarting"; readonly attempt: number }
	| { readonly status: "failed"; readonly reason: string }
	| { readonly status: "stopped" };

export interface DaemonProcessOptions {
	readonly binaryPath?: string;
	readonly probe: () => Promise<boolean>;
	readonly logger?: RuntimedLogger;
	readonly spawnProcess?: (binaryPath: string) => ChildProcess;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
	readonly readyTimeoutMs?: number;
	readonly pollIntervalMs?: number;
	readonly shutdownGraceMs?: number;
	readonly maxRestartAttempts?: number;
	readonly stableUptimeMs?: number;
}

const noopLogger: RuntimedLogger = { info: () => {}, warn: () => {} };

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function restartDelayMs(attempt: number): number {
	return Math.min(INITIAL_RESTART_DELAY_MS * 2 ** (attempt - 1), MAX_RESTART_DELAY_MS);
}

export function daemonUnavailableReason(state: DaemonState): string {
	if (state.status === "failed") return state.reason;
	if (state.status === "restarting")
		return `The bundled notebook service is restarting (attempt ${state.attempt}).`;
	return "The bundled notebook service is not available.";
}

export class DaemonProcessService {
	readonly #binaryPath: string | undefined;
	readonly #probe: () => Promise<boolean>;
	readonly #logger: RuntimedLogger;
	readonly #spawnProcess: (binaryPath: string) => ChildProcess;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #now: () => number;
	readonly #readyTimeoutMs: number;
	readonly #pollIntervalMs: number;
	readonly #shutdownGraceMs: number;
	readonly #maxRestartAttempts: number;
	readonly #stableUptimeMs: number;

	#state: DaemonState = { status: "idle" };
	#child: ChildProcess | undefined;
	#ensuring: Promise<DaemonState> | undefined;
	#restartTimer: NodeJS.Timeout | undefined;
	#restartAttempt = 0;
	#readyAt: number | undefined;
	#disposed = false;
	#disposePromise: Promise<void> | undefined;

	constructor(options: DaemonProcessOptions) {
		this.#binaryPath = options.binaryPath;
		this.#probe = options.probe;
		this.#logger = options.logger ?? noopLogger;
		this.#spawnProcess =
			options.spawnProcess ??
			((binaryPath) =>
				spawn(binaryPath, {
					stdio: "ignore",
					detached: false,
					windowsHide: true,
				}));
		this.#sleep = options.sleep ?? defaultSleep;
		this.#now = options.now ?? Date.now;
		this.#readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
		this.#pollIntervalMs = options.pollIntervalMs ?? READY_POLL_INTERVAL_MS;
		this.#shutdownGraceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
		this.#maxRestartAttempts = options.maxRestartAttempts ?? MAX_RESTART_ATTEMPTS;
		this.#stableUptimeMs = options.stableUptimeMs ?? STABLE_UPTIME_MS;
	}

	get state(): DaemonState {
		return this.#state;
	}

	async ensureRunning(): Promise<DaemonState> {
		if (this.#disposed) return this.#state;
		if (this.#state.status === "running" && this.#child && !childExited(this.#child)) {
			return this.#state;
		}
		if (this.#state.status === "external" && (await this.#probe())) return this.#state;
		this.#ensuring ??= this.#ensure().finally(() => {
			this.#ensuring = undefined;
		});
		return this.#ensuring;
	}

	async #ensure(): Promise<DaemonState> {
		if (this.#restartTimer) {
			clearTimeout(this.#restartTimer);
			this.#restartTimer = undefined;
		}
		this.#state = { status: "starting" };
		if (await this.#probe()) {
			this.#logger.info("[notebook] attached to an already-running daemon");
			this.#state = { status: "external" };
			return this.#state;
		}
		if (!this.#binaryPath) return this.#fail("The bundled notebook service executable is missing.");
		return this.#spawnAndWait();
	}

	async #spawnAndWait(): Promise<DaemonState> {
		const binaryPath = this.#binaryPath;
		if (!binaryPath) return this.#fail("The bundled notebook service executable is missing.");
		let child: ChildProcess;
		try {
			child = this.#spawnProcess(binaryPath);
		} catch (error) {
			return this.#fail(`Could not start the bundled notebook service: ${messageOf(error)}`);
		}
		this.#child = child;
		let spawnError: Error | undefined;
		child.once("exit", (code, signal) => this.#onChildExit(child, code, signal));
		child.on("error", (error: Error) => {
			spawnError = error;
			this.#logger.warn(`[notebook] daemon process error: ${error.message}`);
		});

		const deadline = this.#now() + this.#readyTimeoutMs;
		while (!this.#disposed && this.#now() < deadline) {
			if (spawnError) {
				this.#killChild(child, "SIGKILL");
				if (this.#child === child) this.#child = undefined;
				return this.#fail(`Could not start the bundled notebook service: ${spawnError.message}`);
			}
			if (await this.#probe()) {
				if (childExited(child)) {
					this.#child = undefined;
					this.#logger.info("[notebook] another daemon won the startup race; attached to it");
					this.#state = { status: "external" };
					return this.#state;
				}
				this.#readyAt = this.#now();
				this.#state = { status: "running", pid: child.pid ?? 0 };
				this.#logger.info(`[notebook] bundled daemon ready (pid ${child.pid ?? 0})`);
				return this.#state;
			}
			if (childExited(child)) {
				return this.#fail(
					`The bundled notebook service exited during startup (${describeExit(child)}).`,
				);
			}
			await this.#sleep(this.#pollIntervalMs);
		}
		if (this.#disposed) return this.#state;
		this.#killChild(child, "SIGKILL");
		return this.#fail(
			`The bundled notebook service did not accept connections within ${this.#readyTimeoutMs}ms.`,
		);
	}

	#onChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
		if (this.#child !== child) return;
		this.#child = undefined;
		if (this.#disposed || this.#state.status === "stopped" || this.#state.status === "starting")
			return;
		this.#logger.warn(
			`[notebook] bundled daemon exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`})`,
		);
		const readyAt = this.#readyAt;
		this.#readyAt = undefined;
		if (readyAt !== undefined && this.#now() - readyAt >= this.#stableUptimeMs) {
			this.#restartAttempt = 0;
		}
		if (this.#restartAttempt >= this.#maxRestartAttempts) {
			this.#fail(`The bundled notebook service exited ${this.#restartAttempt} times.`);
			return;
		}
		this.#restartAttempt += 1;
		const attempt = this.#restartAttempt;
		const delay = restartDelayMs(attempt);
		this.#state = { status: "restarting", attempt };
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			if (!this.#disposed) void this.ensureRunning();
		}, delay);
		this.#restartTimer.unref?.();
	}

	#fail(reason: string): DaemonState {
		this.#logger.warn(`[notebook] ${reason}`);
		this.#state = { status: "failed", reason };
		return this.#state;
	}

	dispose(): Promise<void> {
		this.#disposePromise ??= this.#disposeOnce();
		return this.#disposePromise;
	}

	async #disposeOnce(): Promise<void> {
		this.#disposed = true;
		if (this.#restartTimer) clearTimeout(this.#restartTimer);
		this.#restartTimer = undefined;
		const child = this.#child;
		this.#child = undefined;
		this.#state = { status: "stopped" };
		if (!child || childExited(child)) return;

		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		this.#killChild(child, "SIGTERM");
		const timer = setTimeout(() => this.#killChild(child, "SIGKILL"), this.#shutdownGraceMs);
		timer.unref?.();
		try {
			await exited;
		} finally {
			clearTimeout(timer);
		}
	}

	#killChild(child: ChildProcess, signal: NodeJS.Signals): void {
		if (!childExited(child)) child.kill(signal);
	}
}

function childExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function describeExit(child: ChildProcess): string {
	return child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode ?? "unknown"}`;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
