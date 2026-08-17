import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { RuntimedDaemonManager, runtimedRestartDelayMs } from "./RuntimedDaemonManager.js";

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
});
