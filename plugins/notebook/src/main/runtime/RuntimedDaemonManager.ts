import { spawn, type ChildProcess } from "node:child_process";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Owns the lifecycle of the optional runtimed child process, never the shared
 * singleton itself. The canonical endpoint is probed before every spawn because
 * runtimed's lock is channel-scoped rather than socket-scoped; an existing
 * daemon always wins. Only a child created here is restarted or stopped, and a
 * completed socket probe—not process creation or exit code—is the readiness
 * invariant. Concurrent callers share one ensure attempt so notebook tabs cannot
 * race into duplicate children. Dispose SIGTERMs, then SIGKILLs, then gives up
 * so a stuck sidecar cannot block Electron quit.
 */

const READY_POLL_INTERVAL_MS = 150;
const READY_TIMEOUT_MS = 20_000;
const SHUTDOWN_GRACE_MS = 5_000;
const EXIT_WAIT_MS = 1_000;
const INITIAL_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;
const MAX_RESTART_ATTEMPTS = 5;
const STABLE_UPTIME_MS = 60_000;

export type RuntimedDaemonState =
	| { readonly status: "idle" }
	| { readonly status: "probing" }
	| { readonly status: "external" }
	| { readonly status: "starting" }
	| { readonly status: "bundled"; readonly pid: number }
	| { readonly status: "restarting"; readonly attempt: number }
	| { readonly status: "failed"; readonly reason: string }
	| { readonly status: "stopped" };

export interface RuntimedDaemonManagerOptions {
	readonly binaryPath?: string | undefined;
	readonly probe: () => Promise<boolean>;
	readonly logger?: Pick<MainSdkLogger, "info" | "warn">;
	readonly spawnProcess?: (binaryPath: string) => ChildProcess;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
	readonly readyTimeoutMs?: number;
	readonly pollIntervalMs?: number;
	readonly shutdownGraceMs?: number;
	readonly exitWaitMs?: number;
	readonly maxRestartAttempts?: number;
	readonly stableUptimeMs?: number;
}

const noopLogger = { info: () => undefined, warn: () => undefined };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runtimedRestartDelayMs(attempt: number): number {
	return Math.min(INITIAL_RESTART_DELAY_MS * 2 ** (attempt - 1), MAX_RESTART_DELAY_MS);
}

export class RuntimedDaemonManager {
	readonly #binaryPath: string | undefined;
	readonly #probe: () => Promise<boolean>;
	readonly #logger: Pick<MainSdkLogger, "info" | "warn">;
	readonly #spawnProcess: (binaryPath: string) => ChildProcess;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #now: () => number;
	readonly #readyTimeoutMs: number;
	readonly #pollIntervalMs: number;
	readonly #shutdownGraceMs: number;
	readonly #exitWaitMs: number;
	readonly #maxRestartAttempts: number;
	readonly #stableUptimeMs: number;

	#state: RuntimedDaemonState = { status: "idle" };
	#child: ChildProcess | undefined;
	#ensuring: Promise<RuntimedDaemonState> | undefined;
	#restartTimer: NodeJS.Timeout | undefined;
	#restartAttempt = 0;
	#readyAt: number | undefined;
	#disposed = false;
	#disposePromise: Promise<void> | undefined;

	constructor(options: RuntimedDaemonManagerOptions) {
		this.#binaryPath = options.binaryPath;
		this.#probe = options.probe;
		this.#logger = options.logger ?? noopLogger;
		this.#spawnProcess =
			options.spawnProcess ??
			((binaryPath) =>
				spawn(binaryPath, [], {
					stdio: "ignore",
					detached: false,
				}));
		this.#sleep = options.sleep ?? sleep;
		this.#now = options.now ?? Date.now;
		this.#readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
		this.#pollIntervalMs = options.pollIntervalMs ?? READY_POLL_INTERVAL_MS;
		this.#shutdownGraceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
		this.#exitWaitMs = options.exitWaitMs ?? EXIT_WAIT_MS;
		this.#maxRestartAttempts = options.maxRestartAttempts ?? MAX_RESTART_ATTEMPTS;
		this.#stableUptimeMs = options.stableUptimeMs ?? STABLE_UPTIME_MS;
	}

	get state(): RuntimedDaemonState {
		return this.#state;
	}

	ensureAvailable(): Promise<RuntimedDaemonState> {
		if (this.#disposed) return Promise.resolve(this.#state);
		if (this.#state.status === "bundled") {
			return Promise.resolve(this.#state);
		}
		this.#ensuring ??= this.#ensure().finally(() => {
			this.#ensuring = undefined;
		});
		return this.#ensuring;
	}

	async #ensure(): Promise<RuntimedDaemonState> {
		this.#state = { status: "probing" };
		if (await this.#probe()) return this.#attachExternal();
		if (this.#disposed) return this.#state;
		if (!this.#binaryPath) return this.#fail("The bundled runtimed daemon is unavailable.");
		return this.#spawnAndWait();
	}

	#attachExternal(): RuntimedDaemonState {
		this.#logger.info("Using the runtimed daemon already listening on the shared endpoint.");
		this.#state = { status: "external" };
		return this.#state;
	}

	async #spawnAndWait(): Promise<RuntimedDaemonState> {
		const binaryPath = this.#binaryPath;
		if (!binaryPath) return this.#fail("The bundled runtimed daemon is unavailable.");
		this.#state = { status: "starting" };

		let child: ChildProcess;
		try {
			child = this.#spawnProcess(binaryPath);
		} catch (error) {
			return this.#fail(`Could not start the bundled runtimed daemon: ${messageOf(error)}`);
		}

		this.#child = child;
		let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
		let processError: Error | undefined;
		child.once("exit", (code, signal) => {
			exited = { code, signal };
			this.#onChildExit(child, code, signal);
		});
		child.once("error", (error: Error) => {
			processError = error;
			this.#logger.warn(`runtimed process error: ${error.message}`);
		});

		const deadline = this.#now() + this.#readyTimeoutMs;
		while (this.#now() < deadline) {
			if (this.#disposed) return this.#state;
			if (processError) {
				return this.#fail(`Could not start the bundled runtimed daemon: ${processError.message}`);
			}
			if (await this.#probe()) {
				if (exited || child.exitCode !== null || child.signalCode !== null) {
					this.#child = undefined;
					return this.#attachExternal();
				}
				this.#readyAt = this.#now();
				this.#state = { status: "bundled", pid: child.pid ?? 0 };
				this.#logger.info(`Started bundled runtimed daemon (pid ${child.pid ?? 0}).`);
				return this.#state;
			}
			if (exited || child.exitCode !== null || child.signalCode !== null) {
				await this.#sleep(this.#pollIntervalMs);
				continue;
			}
			await this.#sleep(this.#pollIntervalMs);
		}

		if (await this.#probe()) {
			if (exited || child.exitCode !== null || child.signalCode !== null) {
				this.#child = undefined;
				return this.#attachExternal();
			}
		}
		if (exited || child.exitCode !== null || child.signalCode !== null) {
			this.#child = undefined;
			return this.#fail(
				`The bundled runtimed daemon exited before becoming ready (${describeExit(exited, child)}); another daemon may hold the singleton lock.`,
			);
		}
		this.#killChild(child);
		return this.#fail(
			`The bundled runtimed daemon did not accept connections within ${this.#readyTimeoutMs}ms.`,
		);
	}

	#onChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
		if (this.#child !== child) return;
		this.#child = undefined;
		if (this.#disposed || this.#state.status === "stopped" || this.#state.status === "starting") {
			return;
		}

		this.#logger.warn(`Bundled runtimed daemon exited (${describeExit({ code, signal }, child)}).`);
		const readyAt = this.#readyAt;
		this.#readyAt = undefined;
		if (readyAt !== undefined && this.#now() - readyAt >= this.#stableUptimeMs) {
			this.#restartAttempt = 0;
		}
		if (this.#restartAttempt >= this.#maxRestartAttempts) {
			this.#fail(`The bundled runtimed daemon exited ${this.#restartAttempt} times.`);
			return;
		}

		this.#restartAttempt += 1;
		const attempt = this.#restartAttempt;
		const delay = runtimedRestartDelayMs(attempt);
		this.#state = { status: "restarting", attempt };
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			if (!this.#disposed) void this.ensureAvailable();
		}, delay);
		this.#restartTimer.unref?.();
	}

	#fail(reason: string): RuntimedDaemonState {
		this.#logger.warn(reason);
		this.#state = { status: "failed", reason };
		return this.#state;
	}

	dispose(): Promise<void> {
		this.#disposePromise ??= this.#disposeOnce();
		return this.#disposePromise;
	}

	async #disposeOnce(): Promise<void> {
		this.#disposed = true;
		if (this.#restartTimer) {
			clearTimeout(this.#restartTimer);
			this.#restartTimer = undefined;
		}
		const child = this.#child;
		this.#child = undefined;
		this.#state = { status: "stopped" };
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		await this.#waitForChildExit(child);
	}

	async #waitForChildExit(child: ChildProcess): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) return;

		let settle!: () => void;
		const done = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const onExit = () => settle();
		child.once("exit", onExit);
		child.kill("SIGTERM");

		const killTimer = setTimeout(() => this.#killChild(child), this.#shutdownGraceMs);
		const giveUpTimer = setTimeout(settle, this.#shutdownGraceMs + this.#exitWaitMs);
		killTimer.unref?.();
		giveUpTimer.unref?.();
		try {
			await done;
		} finally {
			clearTimeout(killTimer);
			clearTimeout(giveUpTimer);
			child.off("exit", onExit);
		}
	}

	#killChild(child: ChildProcess): void {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	}
}

function describeExit(
	exit: { code: number | null; signal: NodeJS.Signals | null } | undefined,
	child: ChildProcess,
): string {
	const signal = exit?.signal ?? child.signalCode;
	const code = exit?.code ?? child.exitCode;
	return signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
