import { spawn, type ChildProcess } from "node:child_process";

import { compareDaemonVersions } from "./daemon-version.js";
import type { RuntimedLogger } from "./RuntimedService.js";

/**
 * Spawns and supervises the bundled `runtimed` sidecar.
 *
 * Connect-first, on the daemon's *default* socket path: probe first, and only
 * spawn when nothing answers. That ordering is not a nicety — the daemon's
 * single-instance guard is an `flock` on `{daemon_base_dir}/daemon.lock`, and
 * that directory is derived from the compile-time channel, *not* from
 * `--socket`. A daemon that loses the lock logs "another daemon already running"
 * and exits with code **0**, so a spawn can look successful while binding
 * nothing. Staying on the default path makes that harmless: whoever holds the
 * lock is listening on exactly the socket we are about to connect to.
 *
 * Consequently a successful spawn is never treated as readiness. Readiness is
 * only ever a completed connection.
 *
 * Electron-free (enforced by the `*Service.ts` oxlint override): the caller
 * resolves the binary path from `process.resourcesPath` and passes it in.
 */

const READY_POLL_INTERVAL_MS = 150;
const READY_TIMEOUT_MS = 20_000;
const SHUTDOWN_GRACE_MS = 5_000;
const INITIAL_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;
const MAX_RESTART_ATTEMPTS = 5;
/**
 * How long a daemon must stay up before its restart budget is forgiven. Without
 * this, resetting the counter on every successful start would make the budget
 * unreachable: a daemon that binds and immediately dies would restart forever.
 */
const STABLE_UPTIME_MS = 60_000;

export type DaemonState =
	/** No daemon wanted yet — nothing probed, nothing spawned. */
	| { readonly status: "idle" }
	/** Probing, spawning, or waiting for the socket to accept. */
	| { readonly status: "starting" }
	/** A daemon we did not spawn was already listening; we attached to it. */
	| { readonly status: "external" }
	/**
	 * A daemon we did not spawn holds the socket, but it was built from a
	 * different commit than the one we bundle. Terminal: we cannot displace it
	 * (it owns the singleton lock) and we cannot speak to it (typed-frame v4 has
	 * no downgrade path).
	 */
	| {
			readonly status: "incompatible";
			readonly runningVersion: string;
			readonly bundledVersion: string;
	  }
	/** Our child is up and its socket accepted a connection. */
	| { readonly status: "running"; readonly pid: number }
	/** Child died unexpectedly; a restart is scheduled. */
	| { readonly status: "restarting"; readonly attempt: number }
	/** Gave up: no binary, spawn failed, or the restart budget is exhausted. */
	| { readonly status: "failed"; readonly reason: string }
	/** Disposed; no further spawns. */
	| { readonly status: "stopped" };

export interface DaemonProcessOptions {
	/**
	 * Absolute path to the staged `runtimed` binary, or undefined when this build
	 * bundles none. Undefined is not an error: the app treats an unreachable
	 * daemon as an expected state, so we still attach to an external one.
	 */
	readonly binaryPath?: string | undefined;
	/** Resolves once the daemon socket accepts a connection. */
	readonly probe: () => Promise<boolean>;
	/**
	 * Version of the daemon currently listening, as it reports itself. Only
	 * consulted on the attach path — a daemon we spawned is by construction the
	 * one we bundle. Undefined means unidentifiable, which does not block.
	 */
	readonly runningVersion?: () => Promise<string | undefined>;
	/** Version of the staged binary; undefined when this build bundles none. */
	readonly bundledVersion?: () => Promise<string | undefined>;
	readonly logger?: RuntimedLogger;
	/** Test seams. */
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

/** Capped exponential backoff, mirroring launchd's KeepAlive{Crashed} intent. */
export function restartDelayMs(attempt: number): number {
	return Math.min(INITIAL_RESTART_DELAY_MS * 2 ** (attempt - 1), MAX_RESTART_DELAY_MS);
}

export class DaemonProcessService {
	readonly #binaryPath: string | undefined;
	readonly #probe: () => Promise<boolean>;
	readonly #runningVersion: (() => Promise<string | undefined>) | undefined;
	readonly #bundledVersion: (() => Promise<string | undefined>) | undefined;
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

	constructor(options: DaemonProcessOptions) {
		this.#binaryPath = options.binaryPath;
		this.#probe = options.probe;
		this.#runningVersion = options.runningVersion;
		this.#bundledVersion = options.bundledVersion;
		this.#logger = options.logger ?? noopLogger;
		this.#spawnProcess =
			options.spawnProcess ??
			((binaryPath) =>
				spawn(binaryPath, {
					// Holding the child's pipes open hangs the daemon once a buffer
					// fills; nteract's own Windows service redirects all three to NUL
					// for this reason. We have no use for its output — it writes its
					// own `runtimed.log` regardless.
					stdio: "ignore",
					// Not detached: we want it in our process group so it dies with us
					// even if disposal never runs.
					detached: false,
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

	/**
	 * Ensures a daemon is reachable, spawning ours only if none is. Idempotent
	 * and safe to call concurrently: overlapping callers share one attempt, so
	 * two notebook opens cannot race into two spawns.
	 */
	async ensureRunning(): Promise<DaemonState> {
		if (this.#disposed) return this.#state;
		if (this.#state.status === "running" || this.#state.status === "external") {
			return this.#state;
		}
		this.#ensuring ??= this.#ensure().finally(() => {
			this.#ensuring = undefined;
		});
		return this.#ensuring;
	}

	async #ensure(): Promise<DaemonState> {
		this.#state = { status: "starting" };

		if (await this.#probe()) {
			// Could be a user-installed nteract daemon or our own survivor from a
			// previous run; either way it owns the lock and the socket.
			return this.#attachToExternal();
		}

		if (!this.#binaryPath) {
			return this.#fail("no daemon binary is bundled with this build");
		}
		return this.#spawnAndWait();
	}

	/**
	 * Accepts the daemon already on the socket, unless its commit differs from
	 * ours. Restarting it is not an option: killing a daemon we did not start
	 * could drop another app's live kernels, and it holds the lock regardless of
	 * what `--socket` we would pass. Reporting the skew is all we can honestly do.
	 */
	async #attachToExternal(): Promise<DaemonState> {
		const [running, bundled] = await Promise.all([
			this.#runningVersion?.(),
			this.#bundledVersion?.(),
		]);
		if (compareDaemonVersions(running, bundled) === "mismatch") {
			this.#logger.warn(
				`[notebook] the running daemon (${running}) was built from a different commit than the bundled one (${bundled})`,
			);
			this.#state = {
				status: "incompatible",
				runningVersion: running ?? "unknown",
				bundledVersion: bundled ?? "unknown",
			};
			return this.#state;
		}
		this.#logger.info("[notebook] attached to an already-running daemon");
		this.#state = { status: "external" };
		return this.#state;
	}

	async #spawnAndWait(): Promise<DaemonState> {
		const binaryPath = this.#binaryPath;
		if (!binaryPath) return this.#fail("no daemon binary is bundled with this build");

		let child: ChildProcess;
		try {
			// Bare invocation: no `--socket`, so it binds its default path — the one
			// `resolveDaemonSocketPath()` predicts and `#probe` just checked.
			child = this.#spawnProcess(binaryPath);
		} catch (error) {
			return this.#fail(`could not spawn the daemon: ${messageOf(error)}`);
		}

		this.#child = child;
		let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
		child.once("exit", (code, signal) => {
			exited = { code, signal };
			this.#onChildExit(child, code, signal);
		});
		// A spawn error (ENOENT, EACCES) arrives asynchronously and would otherwise
		// be an unhandled 'error' event.
		child.on("error", (error: Error) => {
			this.#logger.warn(`[notebook] daemon process error: ${error.message}`);
		});

		const deadline = this.#now() + this.#readyTimeoutMs;
		while (this.#now() < deadline) {
			if (this.#disposed) return this.#state;
			// Checked before probing so an immediate exit is reported as an exit
			// rather than as a readiness timeout — and note exit code 0 is exactly
			// what the singleton-lock loser returns.
			//
			// The already-exited fields are consulted alongside the event because an
			// exit that landed before this loop attached would otherwise only be
			// noticed as a readiness timeout, seconds later.
			const exitedNow =
				exited ??
				(child.exitCode !== null || child.signalCode !== null
					? { code: child.exitCode, signal: child.signalCode }
					: undefined);
			if (exitedNow) {
				return this.#fail(
					`the daemon exited during startup (${describeExit(exitedNow.code, exitedNow.signal)}); ` +
						`another daemon may already hold the singleton lock`,
				);
			}
			if (await this.#probe()) {
				this.#readyAt = this.#now();
				this.#state = { status: "running", pid: child.pid ?? 0 };
				this.#logger.info(`[notebook] daemon ready (pid ${child.pid ?? 0})`);
				return this.#state;
			}
			await this.#sleep(this.#pollIntervalMs);
		}

		this.#killChild(child);
		return this.#fail(`the daemon did not accept connections within ${this.#readyTimeoutMs}ms`);
	}

	#onChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
		if (this.#child !== child) return;
		this.#child = undefined;
		if (this.#disposed || this.#state.status === "stopped") return;
		// A startup-phase exit is reported by #spawnAndWait, which owns that path.
		if (this.#state.status === "starting") return;

		this.#logger.warn(`[notebook] daemon exited unexpectedly (${describeExit(code, signal)})`);
		// Only a daemon that stayed up earns a fresh budget, so a bind-then-die
		// crash loop still terminates.
		const readyAt = this.#readyAt;
		this.#readyAt = undefined;
		if (readyAt !== undefined && this.#now() - readyAt >= this.#stableUptimeMs) {
			this.#restartAttempt = 0;
		}
		if (this.#restartAttempt >= this.#maxRestartAttempts) {
			this.#fail(`the daemon exited ${this.#restartAttempt} times; not restarting again`);
			return;
		}

		this.#restartAttempt += 1;
		const delay = restartDelayMs(this.#restartAttempt);
		this.#state = { status: "restarting", attempt: this.#restartAttempt };
		this.#logger.info(`[notebook] restarting the daemon in ${delay}ms`);
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			if (this.#disposed) return;
			void this.ensureRunning();
		}, delay);
		this.#restartTimer.unref?.();
	}

	#fail(reason: string): DaemonState {
		this.#logger.warn(`[notebook] ${reason}`);
		this.#state = { status: "failed", reason };
		return this.#state;
	}

	/**
	 * Stops our child, if we own one. Unix gets SIGTERM so the daemon can drain
	 * rooms and unlink its socket; that shutdown can legitimately fail and leave
	 * it running, hence the SIGKILL fallback. Windows has no signal path at all
	 * (the daemon's handler is `#[cfg(unix)]`), so `kill()` there is already a
	 * hard terminate.
	 */
	async dispose(): Promise<void> {
		this.#disposed = true;
		if (this.#restartTimer) {
			clearTimeout(this.#restartTimer);
			this.#restartTimer = undefined;
		}
		const child = this.#child;
		this.#child = undefined;
		this.#state = { status: "stopped" };
		if (!child || child.exitCode !== null || child.signalCode !== null) return;

		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		child.kill("SIGTERM");
		const timer = setTimeout(() => this.#killChild(child), this.#shutdownGraceMs);
		timer.unref?.();
		try {
			await exited;
		} finally {
			clearTimeout(timer);
		}
	}

	#killChild(child: ChildProcess): void {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	}
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
	return signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
