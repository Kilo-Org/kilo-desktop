import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostMessagePort } from "@anaconda-agentic-desktop/feature-sdk/main";

import { TERMINAL_PROTOCOL_VERSION, type TerminalConnectionArgs } from "../../contracts/session.js";
import { historyPath } from "./history.js";
import type { PtyAdapter, PtyExitEvent, PtyProcess, PtySpawnOptions } from "./pty.js";
import { TerminalSessionManager } from "./TerminalSessionManager.js";

class FakePort extends EventEmitter implements HostMessagePort {
	readonly messages: unknown[] = [];
	started = false;
	closed = false;
	postMessage(message: unknown) {
		this.messages.push(message);
	}
	start() {
		this.started = true;
	}
	close() {
		this.closed = true;
		this.emit("close");
	}
}

class FakeProcess implements PtyProcess {
	readonly pid: number;
	readonly writes: string[] = [];
	readonly resizes: Array<[number, number]> = [];
	readonly kills: Array<string | undefined> = [];
	throwOnKillCall: number | null = null;
	#data = new Set<(data: string) => void>();
	#exit = new Set<(event: PtyExitEvent) => void>();
	constructor(pid: number) {
		this.pid = pid;
	}
	write(data: string) {
		this.writes.push(data);
	}
	resize(cols: number, rows: number) {
		this.resizes.push([cols, rows]);
	}
	kill(signal?: string) {
		this.kills.push(signal);
		if (this.kills.length === this.throwOnKillCall) throw new Error("Could not signal process");
	}
	onData(listener: (data: string) => void) {
		this.#data.add(listener);
		return () => this.#data.delete(listener);
	}
	onExit(listener: (event: PtyExitEvent) => void) {
		this.#exit.add(listener);
		return () => this.#exit.delete(listener);
	}
	emitData(data: string) {
		for (const listener of this.#data) listener(data);
	}
	emitExit(event: PtyExitEvent) {
		for (const listener of [...this.#exit]) listener(event);
	}
}

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function setup(
	options: {
		inspectForegroundProcess?: (terminalPid: number) => Promise<string | null>;
		processPollIntervalMs?: number;
		resolveCwd?: (cwd?: string) => Promise<string>;
		logger?: { error(message: string, ...args: unknown[]): void };
		platform?: NodeJS.Platform;
	} = {},
) {
	const storageDir = await mkdtemp(path.join(os.tmpdir(), "terminal-plugin-"));
	directories.push(storageDir);
	const processes: FakeProcess[] = [];
	const spawn = vi.fn((_options: PtySpawnOptions) => {
		const process = new FakeProcess(processes.length + 10);
		processes.push(process);
		return process;
	});
	const manager = new TerminalSessionManager({
		adapter: { spawn } satisfies PtyAdapter,
		storageDir,
		resolveCwd: options.resolveCwd ?? (async (cwd) => cwd ?? "/home/test-user"),
		platform: options.platform ?? "linux",
		env: { SHELL: "/bin/sh", ELECTRON_RUN_AS_NODE: "1" },
		persistDebounceMs: 1,
		killGraceMs: 1,
		...(options.inspectForegroundProcess
			? { inspectForegroundProcess: options.inspectForegroundProcess }
			: {}),
		...(options.processPollIntervalMs
			? { processPollIntervalMs: options.processPollIntervalMs }
			: {}),
		...(options.logger ? { logger: options.logger } : {}),
	});
	const args: TerminalConnectionArgs = {
		protocolVersion: TERMINAL_PROTOCOL_VERSION,
		sessionId: "chat-1",
		terminalId: "terminal-1",
		cwd: "/workspace",
		cols: 120,
		rows: 30,
		initialLabel: "Terminal 1",
	};
	return { args, manager, processes, spawn, storageDir };
}

describe("TerminalSessionManager", () => {
	it("sends a snapshot before live output and reconnects to one main-owned PTY", async () => {
		const { args, manager, processes, spawn } = await setup();
		const first = new FakePort();
		await manager.attach(first, args);
		expect(first.messages[0]).toMatchObject({ type: "snapshot", status: "starting", history: "" });
		expect(first.messages[1]).toEqual({ type: "status", status: "running" });
		processes[0]!.emitData("hello\r\n");
		expect(first.messages[2]).toEqual({ type: "output", data: "hello\r\n" });

		const reconnect = new FakePort();
		await manager.attach(reconnect, args);
		expect(reconnect.messages[0]).toMatchObject({
			type: "snapshot",
			status: "running",
			history: "hello\r\n",
		});
		expect(spawn).toHaveBeenCalledOnce();
		await manager.dispose();
	});

	it("routes input, resize, clear, restart, and exit state", async () => {
		const { args, manager, processes } = await setup();
		const port = new FakePort();
		await manager.attach(port, args);
		port.emit("message", { data: { type: "input", data: "pwd\r" } });
		port.emit("message", { data: { type: "resize", cols: 90, rows: 20 } });
		expect(processes[0]!.writes).toEqual(["pwd\r"]);
		expect(processes[0]!.resizes).toEqual([[90, 20]]);

		processes[0]!.emitData("old output\r\n");
		port.emit("message", { data: { type: "clear", requestId: "clear-1" } });
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "ack", requestId: "clear-1", ok: true }),
		);
		expect(port.messages).toContainEqual({ type: "cleared" });

		port.emit("message", { data: { type: "restart", requestId: "restart-1" } });
		await vi.waitFor(() => expect(processes).toHaveLength(2));
		expect(processes[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);
		processes[1]!.emitExit({ exitCode: 7, signal: null });
		expect(port.messages).toContainEqual({
			type: "status",
			status: "exited",
			exitCode: 7,
			exitSignal: null,
		});
		await manager.dispose();
	});

	it("reports malformed messages and input sent after the shell exits", async () => {
		const { args, manager, processes } = await setup();
		const port = new FakePort();
		await manager.attach(port, args);
		port.emit("message", { data: { type: "unknown" } });
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "error", message: "Invalid terminal message." }),
		);
		processes[0]!.emitExit({ exitCode: 0, signal: null });
		port.emit("message", { data: { type: "input", data: "pwd\r" } });
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "error", message: "The shell is not running." }),
		);
		await manager.dispose();
	});

	it("publishes the foreground command as the label and restores the numbered label when idle", async () => {
		let foregroundProcess = "vite" as string | null;
		const inspectForegroundProcess = vi.fn(async () => foregroundProcess);
		const { args, manager } = await setup({ inspectForegroundProcess, processPollIntervalMs: 1 });
		const port = new FakePort();
		await manager.attach(port, args);

		await vi.waitFor(() => expect(port.messages).toContainEqual({ type: "label", label: "vite" }));
		foregroundProcess = null;
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "label", label: "Terminal 1" }),
		);
		expect(inspectForegroundProcess).toHaveBeenCalledWith(10);
		await manager.dispose();
	});

	it("persists sanitized history and deletes it only on explicit tab close", async () => {
		const { args, manager, processes, storageDir } = await setup();
		await manager.attach(new FakePort(), args);
		processes[0]!.emitData("kept\u001b[6n\r\n");
		await vi.waitFor(async () => {
			expect(await readFile(historyPath(storageDir, args.sessionId, args.terminalId), "utf8")).toBe(
				"kept\r\n",
			);
		});
		await manager.close(args, true);
		await expect(
			readFile(historyPath(storageDir, args.sessionId, args.terminalId), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("does not start a terminal when its tab closes while cwd resolution is pending", async () => {
		let resolveCwd!: (cwd: string) => void;
		const pendingCwd = new Promise<string>((resolve) => {
			resolveCwd = resolve;
		});
		const cwdResolver = vi.fn(() => pendingCwd);
		const { args, manager, spawn } = await setup({ resolveCwd: cwdResolver });
		const attachment = manager.attach(new FakePort(), args);
		await vi.waitFor(() => expect(cwdResolver).toHaveBeenCalledOnce());
		await manager.close(args, true);
		resolveCwd("/workspace");
		await expect(attachment).rejects.toThrow("Terminal session is closed.");
		expect(spawn).not.toHaveBeenCalled();
		await manager.dispose();
	});

	it("does not start a terminal when teardown begins during cwd resolution", async () => {
		let resolveCwd!: (cwd: string) => void;
		const pendingCwd = new Promise<string>((resolve) => {
			resolveCwd = resolve;
		});
		const cwdResolver = vi.fn(() => pendingCwd);
		const { args, manager, spawn } = await setup({ resolveCwd: cwdResolver });
		const attachment = manager.attach(new FakePort(), args);
		await vi.waitFor(() => expect(cwdResolver).toHaveBeenCalledOnce());
		await manager.dispose();
		resolveCwd("/workspace");
		await expect(attachment).rejects.toThrow("Terminal manager is disposed.");
		expect(spawn).not.toHaveBeenCalled();
	});

	it("allows repeated teardown and closing a terminal that was never attached", async () => {
		const { args, manager } = await setup();
		await manager.close(args, false);
		await manager.dispose();
		await expect(manager.dispose()).resolves.toBeUndefined();
	});

	it("reports deferred history persistence failures through the feature logger", async () => {
		const error = vi.fn();
		const { args, manager, processes, storageDir } = await setup({ logger: { error } });
		await manager.attach(new FakePort(), args);
		await rm(storageDir, { recursive: true });
		await writeFile(storageDir, "blocks history directory creation");
		processes[0]!.emitData("output\r\n");
		await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
		await manager.dispose();
	});

	it("flushes history and escalates live processes during teardown", async () => {
		const { args, manager, processes, storageDir } = await setup();
		const port = new FakePort();
		await manager.attach(port, args);
		processes[0]!.emitData("before shutdown\r\n");
		await manager.dispose();
		expect(processes[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);
		expect(port.closed).toBe(true);
		expect(await readFile(historyPath(storageDir, args.sessionId, args.terminalId), "utf8")).toBe(
			"before shutdown\r\n",
		);
	});

	it("finishes explicit close when forced termination reports an error", async () => {
		const { args, manager, processes, storageDir } = await setup();
		const port = new FakePort();
		await manager.attach(port, args);
		processes[0]!.emitData("before close\r\n");
		processes[0]!.throwOnKillCall = 2;

		await expect(manager.close(args, false)).resolves.toBeUndefined();

		expect(processes[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);
		expect(port.closed).toBe(true);
		expect(await readFile(historyPath(storageDir, args.sessionId, args.terminalId), "utf8")).toBe(
			"before close\r\n",
		);
	});

	it("kills Windows PTYs without passing unsupported Unix signals", async () => {
		const { args, manager, processes } = await setup({ platform: "win32" });
		await manager.attach(new FakePort(), args);

		await manager.close(args, true);

		expect(processes[0]!.kills).toEqual([undefined, undefined]);
	});
});
