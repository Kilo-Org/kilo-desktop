import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KernelPort } from "@kilo-desktop/kernel";

import { TERMINAL_PROTOCOL_VERSION, type TerminalConnectionArgs } from "../../contracts/session.js";
import { historyPath } from "./history.js";
import type { PtyAdapter, PtyExitEvent, PtyProcess, PtySpawnOptions } from "./pty.js";
import type { ShellCandidate } from "./shell-launch.js";
import { TerminalSessionManager } from "./TerminalSessionManager.js";

class FakePort implements KernelPort {
	readonly messages: unknown[] = [];
	closed = false;
	readonly #messageListeners = new Set<(data: unknown) => void>();
	readonly #closeListeners = new Set<() => void>();
	postMessage(message: unknown) {
		this.messages.push(message);
	}
	onMessage(listener: (data: unknown) => void) {
		this.#messageListeners.add(listener);
		return () => void this.#messageListeners.delete(listener);
	}
	onClose(listener: () => void) {
		this.#closeListeners.add(listener);
		return () => void this.#closeListeners.delete(listener);
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		for (const listener of [...this.#closeListeners]) listener();
	}
	send(data: unknown) {
		for (const listener of [...this.#messageListeners]) listener(data);
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
		onSessionExited?: (
			identity: { sessionId: string; terminalId: string },
			exit: { exitCode: number | null; exitSignal: number | null },
		) => void;
		onLabelChanged?: (identity: { sessionId: string; terminalId: string }, label: string) => void;
		resolveLaunch?: () => Promise<readonly ShellCandidate[]>;
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
		...(options.onSessionExited ? { onSessionExited: options.onSessionExited } : {}),
		...(options.onLabelChanged ? { onLabelChanged: options.onLabelChanged } : {}),
		...(options.resolveLaunch ? { resolveLaunch: options.resolveLaunch } : {}),
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
	it("sends a snapshot before live output and reconnects without cwd to one main-owned PTY", async () => {
		const { args, manager, processes, spawn } = await setup();
		const first = new FakePort();
		await manager.attach(first, args);
		expect(first.messages[0]).toMatchObject({ type: "snapshot", status: "starting", history: "" });
		expect(first.messages[1]).toEqual({ type: "status", status: "running" });
		processes[0]!.emitData("hello\r\n");
		expect(first.messages[2]).toEqual({ type: "output", data: "hello\r\n" });
		first.close();

		const reconnectArgs = { ...args };
		delete reconnectArgs.cwd;
		const reconnect = new FakePort();
		await manager.attach(reconnect, reconnectArgs);
		expect(reconnect.messages[0]).toMatchObject({
			type: "snapshot",
			status: "running",
			cwd: "/workspace",
			history: "hello\r\n",
		});
		expect(spawn).toHaveBeenCalledOnce();
		expect(processes[0]!.kills).toEqual([]);
		await manager.dispose();
	});

	it("preserves the accepted input sequence across renderer reconnects", async () => {
		const { args, manager } = await setup();
		const first = new FakePort();
		await manager.attach(first, args);
		first.send({ type: "input", requestId: "input-1", data: "a" });
		first.send({ type: "input", requestId: "input-2", data: "b" });
		expect(first.messages).toContainEqual({ type: "input-accepted", count: 2 });
		first.close();

		const reconnectArgs = { ...args };
		delete reconnectArgs.cwd;
		const reconnect = new FakePort();
		await manager.attach(reconnect, reconnectArgs);
		expect(reconnect.messages[0]).toMatchObject({
			type: "snapshot",
			acceptedInputCount: 2,
		});
		await manager.dispose();
	});

	it("starts new terminals at home without cwd and still allows explicit workspace replacement", async () => {
		const { args, manager, processes, spawn } = await setup();
		try {
			const homeArgs = { ...args };
			delete homeArgs.cwd;
			await manager.attach(new FakePort(), homeArgs);
			expect(spawn).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: "/home/test-user" }));
			processes[0]!.emitData("old workspace output\r\n");

			const replacement = new FakePort();
			await manager.attach(replacement, args);
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(processes[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);
			expect(spawn).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: "/workspace" }));
			expect(replacement.messages[0]).toMatchObject({
				type: "snapshot",
				cwd: "/workspace",
				history: "",
			});
		} finally {
			await manager.dispose();
		}
	});

	it("routes input, resize, clear, restart, and exit state", async () => {
		const { args, manager, processes } = await setup();
		const port = new FakePort();
		await manager.attach(port, args);
		port.send({ type: "input", requestId: "input-1", data: "pwd\r" });
		port.send({ type: "resize", cols: 90, rows: 20 });
		expect(processes[0]!.writes).toEqual(["pwd\r"]);
		expect(port.messages).toContainEqual({ type: "ack", requestId: "input-1", ok: true });
		expect(processes[0]!.resizes).toEqual([[90, 20]]);

		processes[0]!.emitData("old output\r\n");
		port.send({ type: "clear", requestId: "clear-1" });
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "ack", requestId: "clear-1", ok: true }),
		);
		expect(port.messages).toContainEqual({ type: "cleared" });

		port.send({ type: "restart", requestId: "restart-1" });
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

	it("reads a plain-text tail from the live session, then from the saved transcript", async () => {
		const { args, manager, processes } = await setup();
		const identity = { sessionId: args.sessionId, terminalId: args.terminalId };
		await expect(manager.read(identity, 10)).resolves.toBeNull();

		await manager.attach(new FakePort(), args);
		processes[0]!.emitData("\u001b[32mbuild ok\u001b[0m\r\nwatching 1%\rwatching...\r\n");
		await expect(manager.read(identity, 1)).resolves.toEqual({
			status: "running",
			label: "Terminal 1",
			cwd: "/workspace",
			exitCode: null,
			exitSignal: null,
			text: "watching...",
			lineCount: 1,
			truncated: true,
		});

		await manager.dispose();
		await expect(manager.read(identity, 10)).resolves.toMatchObject({
			status: "closed",
			label: null,
			text: "build ok\nwatching...",
		});

		await manager.close(identity, true);
		await expect(manager.read(identity, 10)).resolves.toBeNull();
	});

	it("reports malformed messages and input sent after the shell exits", async () => {
		const { args, manager, processes } = await setup();
		const port = new FakePort();
		await manager.attach(port, args);
		port.send({ type: "unknown" });
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "error", message: "Invalid terminal message." }),
		);
		processes[0]!.emitExit({ exitCode: 0, signal: null });
		port.send({ type: "input", requestId: "input-2", data: "pwd\r" });
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({
				type: "ack",
				requestId: "input-2",
				ok: false,
				error: "The shell is not running.",
			}),
		);
		await manager.dispose();
	});

	it("publishes the authoritative terminal identity when the PTY exits", async () => {
		const onSessionExited = vi.fn();
		const { args, manager, processes } = await setup({ onSessionExited });
		await manager.attach(new FakePort(), args);

		processes[0]!.emitExit({ exitCode: 0, signal: null });

		expect(onSessionExited).toHaveBeenCalledOnce();
		expect(onSessionExited).toHaveBeenCalledWith(
			{ sessionId: "chat-1", terminalId: "terminal-1" },
			{ exitCode: 0, exitSignal: null },
		);
		await manager.dispose();
	});

	it("publishes the foreground command as the label and restores the numbered label when idle", async () => {
		let foregroundProcess = "vite" as string | null;
		const inspectForegroundProcess = vi.fn(async () => foregroundProcess);
		const onLabelChanged = vi.fn();
		const { args, manager } = await setup({
			inspectForegroundProcess,
			processPollIntervalMs: 1,
			onLabelChanged,
		});
		const port = new FakePort();
		await manager.attach(port, args);

		await vi.waitFor(() => expect(port.messages).toContainEqual({ type: "label", label: "vite" }));
		foregroundProcess = null;
		await vi.waitFor(() =>
			expect(port.messages).toContainEqual({ type: "label", label: "Terminal 1" }),
		);
		expect(inspectForegroundProcess).toHaveBeenCalledWith(10);
		const identity = { sessionId: "chat-1", terminalId: "terminal-1" };
		expect(onLabelChanged.mock.calls).toEqual([
			[identity, "Terminal 1"],
			[identity, "vite"],
			[identity, "Terminal 1"],
		]);
		await manager.dispose();
	});

	it("reports whether a terminal's shell is running", async () => {
		const { args, manager, processes } = await setup();
		const identity = { sessionId: args.sessionId, terminalId: args.terminalId };
		expect(manager.isRunning(identity)).toBe(false);

		await manager.attach(new FakePort(), args);
		expect(manager.isRunning(identity)).toBe(true);

		processes[0]!.emitExit({ exitCode: 0, signal: null });
		expect(manager.isRunning(identity)).toBe(false);
		await manager.dispose();
	});

	it("persists sanitized history and deletes it only on explicit close", async () => {
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

	it("does not start a terminal when it closes while cwd resolution is pending", async () => {
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

describe("TerminalSessionManager shell profiles", () => {
	it("spawns exactly the shell and args the launch list starts with", async () => {
		const { args, manager, spawn } = await setup({
			resolveLaunch: async () => [
				{ shell: "/opt/homebrew/bin/fish", args: ["-l"] },
				{ shell: "/bin/sh", args: [] },
			],
		});
		await manager.attach(new FakePort(), args);
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawn.mock.calls[0]![0]).toMatchObject({
			shell: "/opt/homebrew/bin/fish",
			args: ["-l"],
			cwd: "/workspace",
		});
		await manager.dispose();
	});

	it("applies a profile's environment without letting it break the terminal's own", async () => {
		const { args, manager, spawn } = await setup({
			resolveLaunch: async () => [
				{
					shell: "/bin/zsh",
					args: [],
					env: { ZDOTDIR: "/tmp/z", SHELL: null, ELECTRON_RUN_AS_NODE: "1", TERM: "dumb" },
				},
			],
		});
		await manager.attach(new FakePort(), args);
		expect(spawn.mock.calls[0]![0].env).toEqual({
			ZDOTDIR: "/tmp/z",
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			TERM_PROGRAM: "Kilo Desktop",
		});
		await manager.dispose();
	});

	it("reads the launch list again when the shell restarts", async () => {
		let shell = "/bin/zsh";
		const { args, manager, spawn } = await setup({
			resolveLaunch: async () => [{ shell, args: [] }],
		});
		const port = new FakePort();
		await manager.attach(port, args);
		shell = "/opt/homebrew/bin/fish";
		port.send({ type: "restart", requestId: "restart-1" });
		await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
		expect(spawn.mock.calls.map(([options]) => options.shell)).toEqual([
			"/bin/zsh",
			"/opt/homebrew/bin/fish",
		]);
		await manager.dispose();
	});

	it("reports an error when there is no shell to launch", async () => {
		const { args, manager, spawn } = await setup({ resolveLaunch: async () => [] });
		const port = new FakePort();
		await manager.attach(port, args);
		expect(spawn).not.toHaveBeenCalled();
		expect(port.messages).toContainEqual({ type: "status", status: "error" });
		expect(port.messages).toContainEqual({
			type: "error",
			message: "Could not start a shell: No supported shell could be started.",
		});
	});

	it("reports an error when the launch list can't be read", async () => {
		const { args, manager } = await setup({
			resolveLaunch: async () => {
				throw new Error("settings unreadable");
			},
		});
		const port = new FakePort();
		await manager.attach(port, args);
		expect(port.messages).toContainEqual({
			type: "error",
			message: "Could not start a shell: settings unreadable",
		});
	});
});
