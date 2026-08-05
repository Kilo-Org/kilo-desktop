import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { DaemonProcessService, restartDelayMs } from "./DaemonProcessService.js";

/**
 * Stands in for a spawned daemon. Only the surface the supervisor touches is
 * modeled: `pid`, `kill`, the `exit`/`error` events, and the `exitCode` /
 * `signalCode` pair the supervisor reads to decide whether a kill is still
 * needed.
 */
class FakeChild extends EventEmitter {
	pid = 4242;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	readonly signals: NodeJS.Signals[] = [];
	/** When true, SIGTERM is ignored — the daemon's shutdown can legitimately fail. */
	ignoreSigterm = false;

	kill(signal: NodeJS.Signals): boolean {
		this.signals.push(signal);
		if (signal === "SIGTERM" && this.ignoreSigterm) return true;
		this.exit(signal === "SIGKILL" ? null : 0, signal);
		return true;
	}

	exit(code: number | null, signal: NodeJS.Signals | null = null): void {
		this.exitCode = code;
		this.signalCode = signal;
		this.emit("exit", code, signal);
	}

	asChildProcess(): ChildProcess {
		return this as unknown as ChildProcess;
	}
}

/** A probe that reports "not listening" until `listening` is flipped. */
function probeSwitch(initial = false) {
	const state = { listening: initial, calls: 0 };
	return {
		state,
		probe: async () => {
			state.calls += 1;
			return state.listening;
		},
	};
}

/**
 * A supervisor wired to a faithful daemon: the endpoint is reachable exactly
 * while a spawned child is alive, and stops being reachable the moment one
 * exits. Modeling that link is what makes the restart path meaningful — a probe
 * that keeps answering after the process dies would let a restart be mistaken
 * for an attach to an external daemon.
 */
function buildWithLiveDaemon(options: { maxRestartAttempts?: number } = {}) {
	const children: FakeChild[] = [];
	const alive = new Set<FakeChild>();
	// Uptime is measured off this clock, so tests control whether a daemon counts
	// as having stayed up long enough to earn a fresh restart budget.
	const clock = { value: 0 };
	const service = new DaemonProcessService({
		binaryPath: "/res/runtimed-nightly",
		probe: async () => alive.size > 0,
		spawnProcess: () => {
			const child = new FakeChild();
			children.push(child);
			alive.add(child);
			child.once("exit", () => alive.delete(child));
			return child.asChildProcess();
		},
		sleep: async () => {},
		now: () => clock.value,
		pollIntervalMs: 1,
		readyTimeoutMs: 1_000,
		stableUptimeMs: 60_000,
		...(options.maxRestartAttempts === undefined
			? {}
			: { maxRestartAttempts: options.maxRestartAttempts }),
	});
	return { service, children, clock, latest: () => children.at(-1) };
}

function build(
	options: {
		binaryPath?: string | undefined;
		probe?: () => Promise<boolean>;
		child?: FakeChild;
		spawnProcess?: (binaryPath: string) => ChildProcess;
		readyTimeoutMs?: number;
		maxRestartAttempts?: number;
		shutdownGraceMs?: number;
	} = {},
) {
	const spawned: string[] = [];
	// Time is driven by the clock the service reads, so readiness timeouts are
	// deterministic rather than wall-clock dependent.
	let clock = 0;
	const service = new DaemonProcessService({
		binaryPath: "binaryPath" in options ? options.binaryPath : "/res/runtimed-nightly",
		probe: options.probe ?? (async () => false),
		spawnProcess:
			options.spawnProcess ??
			((binaryPath) => {
				spawned.push(binaryPath);
				return (options.child ?? new FakeChild()).asChildProcess();
			}),
		// Each sleep advances the fake clock, so the poll loop terminates.
		sleep: async (ms) => {
			clock += ms;
		},
		now: () => clock,
		pollIntervalMs: 100,
		readyTimeoutMs: options.readyTimeoutMs ?? 1_000,
		...(options.maxRestartAttempts === undefined
			? {}
			: { maxRestartAttempts: options.maxRestartAttempts }),
		...(options.shutdownGraceMs === undefined ? {} : { shutdownGraceMs: options.shutdownGraceMs }),
	});
	return { service, spawned };
}

describe("restartDelayMs", () => {
	it("backs off exponentially from the first attempt", () => {
		expect([1, 2, 3, 4].map(restartDelayMs)).toEqual([500, 1_000, 2_000, 4_000]);
	});

	it("caps the delay so a persistently broken daemon is still retried predictably", () => {
		expect(restartDelayMs(20)).toBe(10_000);
	});
});

describe("DaemonProcessService.ensureRunning", () => {
	it("starts idle, having neither probed nor spawned", () => {
		const { service } = build();
		expect(service.state).toEqual({ status: "idle" });
	});

	it("attaches to an already-listening daemon without spawning one", async () => {
		const { service, spawned } = build({ probe: async () => true });

		expect(await service.ensureRunning()).toEqual({ status: "external" });
		expect(spawned).toEqual([]);
	});

	it("spawns the bundled binary when nothing is listening, then reports it running", async () => {
		const { probe, state } = probeSwitch();
		const child = new FakeChild();
		const { service, spawned } = build({
			probe: async () => {
				// Becomes reachable only after the spawn, as a real daemon does.
				const listening = await probe();
				state.listening = true;
				return listening;
			},
			child,
		});

		expect(await service.ensureRunning()).toEqual({ status: "running", pid: 4242 });
		expect(spawned).toEqual(["/res/runtimed-nightly"]);
	});

	it("spawns bare, with no --socket, so the daemon binds the path we probe", async () => {
		const calls: unknown[][] = [];
		const { probe, state } = probeSwitch();
		const { service } = build({
			probe: async () => {
				const listening = await probe();
				state.listening = true;
				return listening;
			},
			spawnProcess: (...args) => {
				calls.push(args);
				return new FakeChild().asChildProcess();
			},
		});

		await service.ensureRunning();

		// A single argument — the binary path — and nothing else. Passing --socket
		// would isolate the socket but not the daemon's singleton lock.
		expect(calls).toEqual([["/res/runtimed-nightly"]]);
	});

	it("fails with a clear reason when this build bundles no daemon", async () => {
		const { service, spawned } = build({ binaryPath: undefined });

		const state = await service.ensureRunning();

		expect(state.status).toBe("failed");
		expect(state).toMatchObject({ reason: expect.stringContaining("no daemon binary") });
		expect(spawned).toEqual([]);
	});

	it("reports a synchronous spawn failure rather than throwing", async () => {
		const { service } = build({
			spawnProcess: () => {
				throw new Error("EACCES");
			},
		});

		const state = await service.ensureRunning();

		expect(state.status).toBe("failed");
		expect(state).toMatchObject({ reason: expect.stringContaining("EACCES") });
	});

	it("treats an exit-0 during startup as a failure, since that is what the lock loser returns", async () => {
		// The daemon exits 0 when another daemon already holds daemon.lock, so a
		// zero exit code must never be read as success.
		const child = new FakeChild();
		const { service } = build({ child });
		const starting = service.ensureRunning();
		child.exit(0);

		const state = await starting;

		expect(state.status).toBe("failed");
		expect(state).toMatchObject({ reason: expect.stringContaining("singleton lock") });
	});

	it("gives up once the readiness deadline passes and kills the unresponsive child", async () => {
		const child = new FakeChild();
		const { service } = build({ child, readyTimeoutMs: 300 });

		const state = await service.ensureRunning();

		expect(state.status).toBe("failed");
		expect(state).toMatchObject({ reason: expect.stringContaining("did not accept connections") });
		expect(child.signals).toContain("SIGKILL");
	});

	it("logs an async spawn error rather than leaving the event unhandled", async () => {
		// ENOENT and EACCES arrive as an 'error' event, not as a spawn throw. An
		// unlistened 'error' on an EventEmitter is rethrown, which in the main
		// process would take down the app.
		const { probe, state } = probeSwitch();
		const child = new FakeChild();
		const warn = vi.fn();
		const service = new DaemonProcessService({
			binaryPath: "/res/runtimed-nightly",
			probe: async () => {
				const listening = await probe();
				state.listening = true;
				return listening;
			},
			spawnProcess: () => child.asChildProcess(),
			sleep: async () => {},
			pollIntervalMs: 1,
			readyTimeoutMs: 1_000,
			logger: { info: () => {}, warn },
		});
		await service.ensureRunning();

		expect(() => child.emit("error", new Error("ENOENT"))).not.toThrow();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
	});

	it("shares one attempt between concurrent callers so two opens cannot double-spawn", async () => {
		const { probe, state } = probeSwitch();
		const { service, spawned } = build({
			probe: async () => {
				const listening = await probe();
				state.listening = true;
				return listening;
			},
		});

		const [first, second] = await Promise.all([service.ensureRunning(), service.ensureRunning()]);

		expect(first).toEqual(second);
		expect(spawned).toHaveLength(1);
	});

	it("short-circuits once running instead of re-probing", async () => {
		const { probe, state } = probeSwitch(true);
		const { service } = build({ probe });
		await service.ensureRunning();
		const callsAfterFirst = state.calls;

		await service.ensureRunning();

		expect(state.calls).toBe(callsAfterFirst);
	});
});

describe("DaemonProcessService restart", () => {
	it("restarts after backoff and returns to running", async () => {
		vi.useFakeTimers();
		try {
			const { service, children, latest } = buildWithLiveDaemon();
			expect((await service.ensureRunning()).status).toBe("running");

			latest()?.exit(1);
			expect(service.state).toEqual({ status: "restarting", attempt: 1 });

			await vi.advanceTimersByTimeAsync(restartDelayMs(1));
			await vi.waitFor(() => expect(service.state.status).toBe("running"));
			expect(children).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not restart a daemon that exited because we asked it to", async () => {
		vi.useFakeTimers();
		try {
			const { service, children } = buildWithLiveDaemon();
			await service.ensureRunning();

			await service.dispose();
			await vi.advanceTimersByTimeAsync(60_000);

			expect(service.state).toEqual({ status: "stopped" });
			expect(children).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops restarting once the attempt budget is exhausted", async () => {
		vi.useFakeTimers();
		try {
			const { service, children, latest } = buildWithLiveDaemon({ maxRestartAttempts: 2 });
			await service.ensureRunning();

			for (let attempt = 1; attempt <= 3; attempt += 1) {
				latest()?.exit(1);
				if (service.state.status === "failed") break;
				await vi.advanceTimersByTimeAsync(restartDelayMs(attempt));
				await vi.waitFor(() => expect(service.state.status).toBe("running"));
			}

			expect(service.state.status).toBe("failed");
			expect(service.state).toMatchObject({ reason: expect.stringContaining("not restarting") });
			// Two restarts allowed on top of the original spawn.
			expect(children).toHaveLength(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("forgives the restart budget for a daemon that stayed up, so a long session is not capped", async () => {
		vi.useFakeTimers();
		try {
			const { service, children, clock, latest } = buildWithLiveDaemon({ maxRestartAttempts: 1 });
			await service.ensureRunning();

			// Exhaust the budget, then survive a long stretch before dying again.
			latest()?.exit(1);
			await vi.advanceTimersByTimeAsync(restartDelayMs(1));
			await vi.waitFor(() => expect(service.state.status).toBe("running"));
			clock.value += 60_000;
			latest()?.exit(1);

			// With the budget forgiven this is attempt 1 again, not a give-up.
			expect(service.state).toEqual({ status: "restarting", attempt: 1 });
			await vi.advanceTimersByTimeAsync(restartDelayMs(1));
			await vi.waitFor(() => expect(service.state.status).toBe("running"));
			expect(children).toHaveLength(3);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("DaemonProcessService.dispose", () => {
	it("asks the daemon to shut down gracefully so it can unlink its socket", async () => {
		const { probe, state } = probeSwitch();
		const child = new FakeChild();
		const { service } = build({
			probe: async () => {
				const listening = await probe();
				state.listening = true;
				return listening;
			},
			child,
		});
		await service.ensureRunning();

		await service.dispose();

		expect(child.signals).toEqual(["SIGTERM"]);
		expect(service.state).toEqual({ status: "stopped" });
	});

	it("escalates to SIGKILL when the daemon ignores SIGTERM", async () => {
		vi.useFakeTimers();
		try {
			const { probe, state } = probeSwitch();
			const child = new FakeChild();
			// The daemon's own shutdown can fail when a room is not durable yet, so
			// it can legitimately survive SIGTERM.
			child.ignoreSigterm = true;
			const { service } = build({
				probe: async () => {
					const listening = await probe();
					state.listening = true;
					return listening;
				},
				child,
				shutdownGraceMs: 50,
			});
			await service.ensureRunning();

			const disposed = service.dispose();
			await vi.advanceTimersByTimeAsync(50);
			await disposed;

			expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("is safe with no child, and refuses to spawn afterwards", async () => {
		const { service, spawned } = build();

		await service.dispose();

		expect(service.state).toEqual({ status: "stopped" });
		expect(await service.ensureRunning()).toEqual({ status: "stopped" });
		expect(spawned).toEqual([]);
	});

	it("cancels a pending restart instead of spawning after disposal", async () => {
		vi.useFakeTimers();
		try {
			const children: FakeChild[] = [];
			const listening = { value: false };
			const service = new DaemonProcessService({
				binaryPath: "/res/runtimed-nightly",
				probe: async () => {
					const wasListening = listening.value;
					listening.value = true;
					return wasListening;
				},
				spawnProcess: () => {
					listening.value = false;
					const child = new FakeChild();
					children.push(child);
					return child.asChildProcess();
				},
				sleep: async () => {},
				pollIntervalMs: 1,
				readyTimeoutMs: 1_000,
			});
			await service.ensureRunning();
			children.at(-1)?.exit(1);
			expect(service.state.status).toBe("restarting");

			await service.dispose();
			await vi.advanceTimersByTimeAsync(60_000);

			expect(service.state).toEqual({ status: "stopped" });
			expect(children).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not signal a child that has already exited", async () => {
		const { probe, state } = probeSwitch();
		const child = new FakeChild();
		const { service } = build({
			probe: async () => {
				const listening = await probe();
				state.listening = true;
				return listening;
			},
			child,
		});
		await service.ensureRunning();
		child.exit(0);

		await service.dispose();

		expect(child.signals).toEqual([]);
	});
});
