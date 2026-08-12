import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DaemonProcessService, restartDelayMs } from "./DaemonProcessService.js";

class FakeChild extends EventEmitter {
	readonly pid: number;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	readonly kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
		this.signalCode = signal;
		this.emit("exit", null, signal);
		return true;
	});

	constructor(pid = 101) {
		super();
		this.pid = pid;
	}

	exit(code: number): void {
		this.exitCode = code;
		this.emit("exit", code, null);
	}
}

function asChild(child: FakeChild): ChildProcess {
	return child as unknown as ChildProcess;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("DaemonProcessService", () => {
	it("attaches to a compatible singleton without taking ownership", async () => {
		const spawnProcess = vi.fn();
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => true,
			spawnProcess,
		});

		await expect(service.ensureRunning()).resolves.toEqual({ status: "external" });
		expect(spawnProcess).not.toHaveBeenCalled();
		await service.dispose();
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	it("deduplicates concurrent starts and waits for the owned child", async () => {
		const child = new FakeChild();
		let listening = false;
		const spawnProcess = vi.fn(() => {
			listening = true;
			return asChild(child);
		});
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => listening,
			spawnProcess,
		});

		const [first, second] = await Promise.all([service.ensureRunning(), service.ensureRunning()]);
		expect(first).toEqual({ status: "running", pid: 101 });
		expect(second).toEqual(first);
		expect(spawnProcess).toHaveBeenCalledOnce();
		await service.dispose();
	});

	it("attaches when another process wins the singleton startup race", async () => {
		const child = new FakeChild();
		let probes = 0;
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => ++probes > 1,
			spawnProcess: () => {
				child.exit(0);
				return asChild(child);
			},
		});

		await expect(service.ensureRunning()).resolves.toEqual({ status: "external" });
	});

	it("reports a missing bundled executable as an actionable startup failure", async () => {
		const service = new DaemonProcessService({ probe: async () => false });

		await expect(service.ensureRunning()).resolves.toEqual({
			status: "failed",
			reason: "The bundled notebook service executable is missing.",
		});
	});

	it("reports an asynchronous spawn failure without waiting for readiness timeout", async () => {
		const child = new FakeChild();
		const service = new DaemonProcessService({
			binaryPath: "/missing/runtimed",
			probe: async () => false,
			spawnProcess: () => {
				queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
				return asChild(child);
			},
			sleep: async () => Promise.resolve(),
		});

		await expect(service.ensureRunning()).resolves.toEqual({
			status: "failed",
			reason: "Could not start the bundled notebook service: spawn ENOENT",
		});
	});

	it("kills a child that never opens the socket", async () => {
		const child = new FakeChild();
		let now = 0;
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => false,
			spawnProcess: () => asChild(child),
			now: () => now,
			sleep: async (ms) => {
				now += ms;
			},
			readyTimeoutMs: 10,
			pollIntervalMs: 10,
		});

		const state = await service.ensureRunning();
		expect(state.status).toBe("failed");
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	});

	it("re-probes an external daemon and starts the bundle after it disappears", async () => {
		const child = new FakeChild();
		let listening = true;
		const spawnProcess = vi.fn(() => {
			listening = true;
			return asChild(child);
		});
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => listening,
			spawnProcess,
		});
		await service.ensureRunning();

		listening = false;
		await expect(service.ensureRunning()).resolves.toEqual({ status: "running", pid: 101 });
		expect(spawnProcess).toHaveBeenCalledOnce();
		await service.dispose();
	});

	it("restarts owned crashes with capped exponential backoff", async () => {
		vi.useFakeTimers();
		const children = [new FakeChild(101), new FakeChild(102)];
		let listening = false;
		const spawnProcess = vi.fn(() => {
			listening = true;
			return asChild(children[spawnProcess.mock.calls.length - 1]!);
		});
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => listening,
			spawnProcess,
		});
		await service.ensureRunning();

		listening = false;
		children[0]!.exit(1);
		expect(service.state).toEqual({ status: "restarting", attempt: 1 });
		await vi.advanceTimersByTimeAsync(restartDelayMs(1));
		await expect.poll(() => service.state).toEqual({ status: "running", pid: 102 });
		await service.dispose();
	});

	it("stops restarting after the configured crash limit", async () => {
		vi.useFakeTimers();
		const children = [new FakeChild(101), new FakeChild(102)];
		let listening = false;
		const spawnProcess = vi.fn(() => {
			listening = true;
			return asChild(children[spawnProcess.mock.calls.length - 1]!);
		});
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => listening,
			spawnProcess,
			maxRestartAttempts: 1,
		});
		await service.ensureRunning();
		listening = false;
		children[0]!.exit(1);
		await vi.advanceTimersByTimeAsync(restartDelayMs(1));
		await expect.poll(() => service.state).toEqual({ status: "running", pid: 102 });

		listening = false;
		children[1]!.exit(1);
		expect(service.state).toEqual({
			status: "failed",
			reason: "The bundled notebook service exited 1 times.",
		});
	});

	it("stops only an app-owned child", async () => {
		const child = new FakeChild();
		let listening = false;
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => listening,
			spawnProcess: () => {
				listening = true;
				return asChild(child);
			},
		});
		await service.ensureRunning();

		await service.dispose();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(service.state).toEqual({ status: "stopped" });
	});

	it("hard-kills an owned child after the graceful shutdown bound", async () => {
		vi.useFakeTimers();
		const child = new FakeChild();
		child.kill.mockImplementation((signal: NodeJS.Signals = "SIGTERM") => {
			if (signal === "SIGKILL") {
				child.signalCode = signal;
				child.emit("exit", null, signal);
			}
			return true;
		});
		let listening = false;
		const service = new DaemonProcessService({
			binaryPath: "/bundled/runtimed",
			probe: async () => listening,
			spawnProcess: () => {
				listening = true;
				return asChild(child);
			},
			shutdownGraceMs: 25,
		});
		await service.ensureRunning();

		const disposed = service.dispose();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		await vi.advanceTimersByTimeAsync(25);
		await disposed;
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	});
});
