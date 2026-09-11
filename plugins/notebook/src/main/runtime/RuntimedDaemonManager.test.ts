import type { ChildProcess } from "node:child_process";
import * as childProcesses from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimedDaemonManager, runtimedRestartDelayMs } from "./RuntimedDaemonManager.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

class FakeChild extends EventEmitter {
	pid = 4242;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	readonly signals: NodeJS.Signals[] = [];

	kill(signal: NodeJS.Signals): boolean {
		this.signals.push(signal);
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

function build(
	options: {
		binaryPath?: string | undefined;
		probe?: () => Promise<boolean>;
		spawnProcess?: (binaryPath: string) => ChildProcess;
		readyTimeoutMs?: number;
	} = {},
) {
	let clock = 0;
	const spawned: string[] = [];
	const child = new FakeChild();
	const manager = new RuntimedDaemonManager({
		binaryPath: "binaryPath" in options ? options.binaryPath : "/resources/runtimed-nightly",
		probe: options.probe ?? (async () => false),
		spawnProcess:
			options.spawnProcess ??
			((binaryPath) => {
				spawned.push(binaryPath);
				return child.asChildProcess();
			}),
		sleep: async (ms) => {
			clock += ms;
		},
		now: () => clock,
		pollIntervalMs: 10,
		readyTimeoutMs: options.readyTimeoutMs ?? 100,
	});
	return { child, manager, spawned };
}

describe("runtimedRestartDelayMs", () => {
	it("uses capped exponential backoff", () => {
		expect([1, 2, 3, 4, 20].map(runtimedRestartDelayMs)).toEqual([
			500, 1_000, 2_000, 4_000, 10_000,
		]);
	});
});

describe("RuntimedDaemonManager", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("spawns in the shared namespace even when Electron inherits worktree variables", async () => {
		vi.stubEnv("RUNTIMED_DEV", "1");
		vi.stubEnv("RUNTIMED_WORKSPACE_PATH", "/some/nteract-worktree");
		vi.stubEnv("RUNTIMED_SOCKET_PATH", "/some/other.sock");
		const child = new FakeChild();
		const spawn = vi.mocked(childProcesses.spawn).mockReturnValue(child.asChildProcess());
		let probes = 0;
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => ++probes > 1,
		});
		try {
			expect(await manager.ensureAvailable()).toMatchObject({ status: "bundled" });
			const options = spawn.mock.calls[0]?.[2];
			expect(options?.env).toBeDefined();
			expect(options?.env).not.toHaveProperty("RUNTIMED_DEV");
			expect(options?.env).not.toHaveProperty("RUNTIMED_WORKSPACE_PATH");
			expect(options?.env).not.toHaveProperty("RUNTIMED_SOCKET_PATH");
			expect(process.env["RUNTIMED_DEV"]).toBe("1");
		} finally {
			await manager.dispose();
		}
	});

	it("never spawns for an explicit attach-only endpoint", async () => {
		const spawnProcess = vi.fn();
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			allowSpawn: false,
			probe: async () => false,
			spawnProcess,
		});
		expect(await manager.ensureAvailable()).toMatchObject({
			status: "failed",
			reason: expect.stringContaining("selected notebook runtime"),
		});
		expect(spawnProcess).not.toHaveBeenCalled();
		await manager.dispose();
	});

	it.each(["unresponsive", "ready", "disposed"])(
		"waits for a listening endpoint: %s",
		async (outcome) => {
			const directory = await mkdtemp(path.join(os.tmpdir(), "kd-probe-"));
			const socketPath =
				process.platform === "win32"
					? `\\\\.\\pipe\\kd-probe-${process.pid}-${Date.now()}`
					: path.join(directory, "daemon.sock");
			const server = createServer((socket) => socket.end());
			await new Promise<void>((resolve) => server.listen(socketPath, resolve));
			const spawnProcess = vi.fn();
			let clock = 0;
			let probes = 0;
			const manager = new RuntimedDaemonManager({
				socketPath,
				binaryPath: "/resources/runtimed-nightly",
				probe: async () => ++probes > 1 && outcome === "ready",
				spawnProcess,
				now: () => clock,
				sleep: async (ms) => {
					clock += ms;
					if (outcome === "disposed") await manager.dispose();
				},
				readyTimeoutMs: 20,
				pollIntervalMs: 10,
			});
			try {
				const result = await manager.ensureAvailable();
				if (outcome === "unresponsive") {
					expect(result).toMatchObject({
						status: "failed",
						reason: expect.stringContaining("metadata"),
					});
				} else {
					expect(result).toEqual({ status: outcome === "ready" ? "external" : "stopped" });
				}
				expect(spawnProcess).not.toHaveBeenCalled();
			} finally {
				await manager.dispose();
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
				await rm(directory, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32").each(["absent", "stale", "blocked"])(
		"classifies a %s endpoint before spawning",
		async (kind) => {
			const directory = await mkdtemp(path.join(os.tmpdir(), "kd-probe-"));
			const entry = path.join(directory, "daemon.sock");
			if (kind === "blocked") await writeFile(entry, "not a directory");
			if (kind === "stale") {
				const initialPath = path.join(directory, "initial.sock");
				const server = createServer();
				await new Promise<void>((resolve) => server.listen(initialPath, resolve));
				await rename(initialPath, entry);
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
			const socketPath = kind === "blocked" ? path.join(entry, "socket") : entry;
			const child = new FakeChild();
			const spawnProcess = vi.fn(() => child.asChildProcess());
			let probes = 0;
			const manager = new RuntimedDaemonManager({
				socketPath,
				binaryPath: "/resources/runtimed-nightly",
				probe: async () => ++probes > 1,
				spawnProcess,
			});
			try {
				const result = await manager.ensureAvailable();
				if (kind === "blocked") {
					expect(result).toMatchObject({
						status: "failed",
						reason: expect.stringContaining("Could not access"),
					});
					expect(spawnProcess).not.toHaveBeenCalled();
				} else {
					expect(result).toMatchObject({ status: "bundled" });
					expect(spawnProcess).toHaveBeenCalledOnce();
				}
			} finally {
				await manager.dispose();
				await rm(directory, { recursive: true, force: true });
			}
		},
	);

	it("starts when the selected socket or Windows named pipe is absent", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kd-absent-"));
		const socketPath =
			process.platform === "win32"
				? `\\\\.\\pipe\\${path.basename(directory)}`
				: path.join(directory, "daemon.sock");
		const child = new FakeChild();
		const spawnProcess = vi.fn(() => child.asChildProcess());
		let probes = 0;
		const manager = new RuntimedDaemonManager({
			socketPath,
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => ++probes > 1,
			spawnProcess,
		});
		try {
			expect(await manager.ensureAvailable()).toMatchObject({ status: "bundled" });
			expect(spawnProcess).toHaveBeenCalledOnce();
		} finally {
			await manager.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== "darwin")(
		"reports a non-socket file without deleting it or spawning",
		async () => {
			const directory = await mkdtemp(path.join(os.tmpdir(), "kd-file-"));
			const socketPath = path.join(directory, "daemon.sock");
			await writeFile(socketPath, "not a socket");
			const spawnProcess = vi.fn();
			const manager = new RuntimedDaemonManager({
				socketPath,
				binaryPath: "/resources/runtimed-nightly",
				probe: async () => false,
				spawnProcess,
			});
			try {
				expect(await manager.ensureAvailable()).toMatchObject({
					status: "failed",
					reason: expect.stringContaining("ENOTSOCK"),
				});
				expect(spawnProcess).not.toHaveBeenCalled();
				expect(await readFile(socketPath, "utf8")).toBe("not a socket");
			} finally {
				await manager.dispose();
				await rm(directory, { recursive: true, force: true });
			}
		},
	);

	it("attaches to an existing singleton without spawning", async () => {
		const spawnProcess = vi.fn();
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => true,
			spawnProcess,
		});

		expect(await manager.ensureAvailable()).toEqual({ status: "external" });
		expect(spawnProcess).not.toHaveBeenCalled();
		await manager.dispose();
	});

	it("starts the bundled daemon if an external singleton later disappears", async () => {
		let externalIsRunning = true;
		const child = new FakeChild();
		const spawned: string[] = [];
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => externalIsRunning,
			spawnProcess: (binaryPath) => {
				spawned.push(binaryPath);
				externalIsRunning = true;
				return child.asChildProcess();
			},
		});

		expect(await manager.ensureAvailable()).toEqual({ status: "external" });
		externalIsRunning = false;
		expect(await manager.ensureAvailable()).toEqual({ status: "bundled", pid: 4242 });
		expect(spawned).toEqual(["/resources/runtimed-nightly"]);
		await manager.dispose();
	});

	it("starts only the bundled binary when no daemon is listening", async () => {
		let probes = 0;
		const { manager, spawned } = build({
			probe: async () => ++probes > 1,
		});

		expect(await manager.ensureAvailable()).toEqual({ status: "bundled", pid: 4242 });
		expect(spawned).toEqual(["/resources/runtimed-nightly"]);
		await manager.dispose();
	});

	it("deduplicates concurrent startup attempts", async () => {
		let probes = 0;
		const { manager, spawned } = build({
			probe: async () => ++probes > 1,
		});

		const [first, second] = await Promise.all([
			manager.ensureAvailable(),
			manager.ensureAvailable(),
		]);
		expect(first).toEqual(second);
		expect(spawned).toHaveLength(1);
		await manager.dispose();
	});

	it("re-probes and attaches when another daemon wins the startup race", async () => {
		const child = new FakeChild();
		let probes = 0;
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => {
				probes += 1;
				if (probes === 2) child.exit(0);
				return probes >= 3;
			},
			spawnProcess: () => child.asChildProcess(),
			sleep: async () => undefined,
			readyTimeoutMs: 100,
			pollIntervalMs: 1,
		});

		expect(await manager.ensureAvailable()).toEqual({ status: "external" });
		await manager.dispose();
	});

	it("reports a missing bundled daemon without searching the system", async () => {
		const { manager } = build({ binaryPath: undefined });
		expect(await manager.ensureAvailable()).toEqual({
			status: "failed",
			reason: "The bundled runtimed daemon is unavailable.",
		});
		await manager.dispose();
	});

	it("reports a readiness timeout and terminates its child", async () => {
		const { child, manager } = build({ readyTimeoutMs: 20 });
		const result = await manager.ensureAvailable();
		expect(result).toMatchObject({
			status: "failed",
			reason: expect.stringContaining("did not accept connections"),
		});
		expect(child.signals).toContain("SIGKILL");
		await manager.dispose();
	});

	it("does not hang dispose when the bundled daemon ignores signals", async () => {
		class StickyChild extends FakeChild {
			override kill(signal: NodeJS.Signals): boolean {
				this.signals.push(signal);
				return true;
			}
		}

		const child = new StickyChild();
		let listening = false;
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => listening,
			spawnProcess: () => {
				listening = true;
				return child.asChildProcess();
			},
			sleep: async () => undefined,
			readyTimeoutMs: 50,
			pollIntervalMs: 1,
			shutdownGraceMs: 20,
			exitWaitMs: 20,
		});

		expect(await manager.ensureAvailable()).toEqual({ status: "bundled", pid: 4242 });
		await manager.dispose();
		expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
		expect(manager.state).toEqual({ status: "stopped" });
	});

	it("stops only a child it owns", async () => {
		let probes = 0;
		const owned = build({ probe: async () => ++probes > 1 });
		await owned.manager.ensureAvailable();
		await owned.manager.dispose();
		expect(owned.child.signals).toContain("SIGTERM");

		const externalChild = new FakeChild();
		const external = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => true,
			spawnProcess: () => externalChild.asChildProcess(),
		});
		await external.ensureAvailable();
		await external.dispose();
		expect(externalChild.signals).toEqual([]);
	});

	it("fails when spawning the bundled daemon throws", async () => {
		const { manager } = build({
			spawnProcess: () => {
				throw new Error("ENOENT");
			},
		});
		expect(await manager.ensureAvailable()).toEqual({
			status: "failed",
			reason: "Could not start the bundled runtimed daemon: ENOENT",
		});
		await manager.dispose();
	});

	it("fails when the bundled process emits an error before it is ready", async () => {
		const child = new FakeChild();
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => false,
			spawnProcess: () => {
				queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
				return child.asChildProcess();
			},
			sleep: async () => undefined,
			readyTimeoutMs: 50,
			pollIntervalMs: 1,
		});

		expect(await manager.ensureAvailable()).toEqual({
			status: "failed",
			reason: "Could not start the bundled runtimed daemon: spawn EACCES",
		});
		await manager.dispose();
	});

	it("restarts a bundled daemon that exits after becoming ready", async () => {
		vi.useFakeTimers();
		try {
			let listening = false;
			const spawned: FakeChild[] = [];
			const manager = new RuntimedDaemonManager({
				binaryPath: "/resources/runtimed-nightly",
				probe: async () => listening,
				spawnProcess: () => {
					const next = new FakeChild();
					spawned.push(next);
					listening = true;
					return next.asChildProcess();
				},
				sleep: async () => undefined,
				now: () => 0,
				readyTimeoutMs: 50,
				pollIntervalMs: 1,
			});

			expect(await manager.ensureAvailable()).toEqual({ status: "bundled", pid: 4242 });
			listening = false;
			spawned[0]!.exit(1);
			expect(manager.state).toEqual({ status: "restarting", attempt: 1 });
			await vi.runAllTimersAsync();
			expect(spawned).toHaveLength(2);
			await manager.dispose();
			expect(manager.state).toEqual({ status: "stopped" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns the current state when already bundled or disposed", async () => {
		let probes = 0;
		const { manager } = build({ probe: async () => ++probes > 1 });
		const bundled = await manager.ensureAvailable();
		expect(await manager.ensureAvailable()).toEqual(bundled);
		await manager.dispose();
		expect(await manager.ensureAvailable()).toEqual({ status: "stopped" });
	});

	it("fails when the bundled process exits before the socket is ready", async () => {
		const child = new FakeChild();
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => false,
			spawnProcess: () => {
				queueMicrotask(() => child.exit(1));
				return child.asChildProcess();
			},
			sleep: async () => undefined,
			readyTimeoutMs: 20,
			pollIntervalMs: 1,
		});

		expect(await manager.ensureAvailable()).toMatchObject({
			status: "failed",
			reason: expect.stringContaining("exited before becoming ready"),
		});
		await manager.dispose();
	});

	it("attaches to an external daemon that appears after the bundled child exits", async () => {
		const child = new FakeChild();
		let listening = false;
		const manager = new RuntimedDaemonManager({
			binaryPath: "/resources/runtimed-nightly",
			probe: async () => listening,
			spawnProcess: () => {
				queueMicrotask(() => {
					listening = true;
					child.exit(0);
				});
				return child.asChildProcess();
			},
			sleep: async () => undefined,
			readyTimeoutMs: 20,
			pollIntervalMs: 1,
		});

		expect(await manager.ensureAvailable()).toEqual({ status: "external" });
		await manager.dispose();
	});

	it("stops restarting after the maximum number of crashes", async () => {
		vi.useFakeTimers();
		try {
			let listening = false;
			const spawned: FakeChild[] = [];
			const manager = new RuntimedDaemonManager({
				binaryPath: "/resources/runtimed-nightly",
				probe: async () => listening,
				spawnProcess: () => {
					const next = new FakeChild();
					spawned.push(next);
					listening = true;
					return next.asChildProcess();
				},
				sleep: async () => undefined,
				now: () => 0,
				readyTimeoutMs: 50,
				pollIntervalMs: 1,
				maxRestartAttempts: 1,
			});

			expect(await manager.ensureAvailable()).toEqual({ status: "bundled", pid: 4242 });
			listening = false;
			spawned[0]!.exit(1);
			await vi.runAllTimersAsync();
			listening = false;
			spawned[1]!.exit(1);
			expect(manager.state).toEqual({
				status: "failed",
				reason: "The bundled runtimed daemon exited 1 times.",
			});
			await manager.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("stringifies non-Error spawn failures", async () => {
		const { manager } = build({
			spawnProcess: () => {
				throw "ENOENT";
			},
		});
		expect(await manager.ensureAvailable()).toEqual({
			status: "failed",
			reason: "Could not start the bundled runtimed daemon: ENOENT",
		});
		await manager.dispose();
	});
});
