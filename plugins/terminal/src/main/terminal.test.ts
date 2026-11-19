import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
	WorkSessions,
	type WorkSessionPanes,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import type { CustomTerminalProfile, TerminalExited, TerminalProfile } from "../contracts";
import { TERMINAL_PROTOCOL_VERSION, type TerminalReadout } from "../contracts/session";
import { historyPath } from "./sessions/history";
import type { PtyExitEvent, PtyProcess } from "./sessions/pty";
import { TerminalSessionManager } from "./sessions/TerminalSessionManager";
import {
	bootTerminalMain as boot,
	recordingLogger,
	stopTerminalMains,
	tempDir,
	terminalPane,
	WORK_SESSION as SESSION,
} from "./test-boot";

afterEach(stopTerminalMains);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("kilo.terminal in main", () => {
	it("serves the frame from its resources on the terminal host, allowed to copy", async () => {
		const { register } = await boot();

		expect(register).toHaveBeenCalledWith({
			host: "terminal",
			root: "/app/resources/terminal",
			permissions: ["clipboard-sanitized-write"],
		});
	});

	it("activates without an embedded host where the host has none", async () => {
		const { terminals } = await boot({ embedded: false });

		expect(terminals).not.toBeNull();
	});

	it("activates without kilo.work-sessions and kilo.core, warning of nothing", async () => {
		const { logger, warnings, errors } = recordingLogger();
		const { main, terminals } = await boot({
			withoutWorkSessions: true,
			withoutCore: true,
			logger,
		});

		await expect(terminals.methods.list({ workSessionId: SESSION.id })).resolves.toEqual([]);
		expect(main.kernelSdk.extensions.list(Tool)).toEqual([]);
		// The kernel reports kilo.terminal's manifest contributions to absent plugins; the entry says nothing.
		const own = warnings.filter(
			([message]) => !String(message).startsWith("[kilo.terminal] Contribution"),
		);
		expect(own).toEqual([]);
		expect(errors).toEqual([]);
	});

	it("closes a terminal's shell and deletes its history when its pane closes", async () => {
		const { workSessions: sessions, fake } = await boot({
			panes: {
				[SESSION.id]: {
					...EMPTY_WORK_SESSION_PANES,
					panes: [
						terminalPane("a"),
						terminalPane("b", { terminalSessionId: "ses_origin" }),
						{ ...terminalPane("c"), kind: "kilo.git/changes" },
					],
				},
			},
		});

		const handle = sessions.panes();
		const close = (paneId: string) =>
			handle.emit("closed", {
				workSessionId: SESSION.id,
				pane: handle.state.byWorkSession[SESSION.id]!.panes.find((pane) => pane.id === paneId)!,
			});
		close("a");
		close("b");
		close("c");
		await flush();

		expect(fake.close.mock.calls).toEqual([
			[{ sessionId: SESSION.id, terminalId: "a" }, true],
			[{ sessionId: "ses_origin", terminalId: "b" }, true],
		]);
	});

	it("closes a deleted work session's terminals, though its panes went first", async () => {
		const { main, fake } = await boot({
			panes: {
				[SESSION.id]: {
					...EMPTY_WORK_SESSION_PANES,
					panes: [terminalPane("a"), terminalPane("b", { terminalSessionId: "ses_origin" })],
				},
				other: { ...EMPTY_WORK_SESSION_PANES, panes: [terminalPane("x")] },
			},
		});

		await main.kernelSdk.domainObjects.get(WorkSessions)!.methods.remove({ id: SESSION.id });
		await flush();

		expect(fake.close.mock.calls).toEqual([
			[{ sessionId: SESSION.id, terminalId: "a" }, true],
			[{ sessionId: "ses_origin", terminalId: "b" }, true],
		]);
	});

	it("closes the pane when its shell exits, announcing the exit under the pane's work session", async () => {
		const {
			workSessions: sessions,
			fake,
			terminals,
		} = await boot({
			panes: {
				[SESSION.id]: {
					...EMPTY_WORK_SESSION_PANES,
					panes: [terminalPane("a", { terminalSessionId: "ses_origin" })],
				},
			},
		});
		const exited: TerminalExited[] = [];
		terminals.on("exited", (event) => exited.push(event));

		fake.deps!.onSessionExited(
			{ sessionId: "ses_origin", terminalId: "a" },
			{ exitCode: 0, exitSignal: null },
		);
		await flush();

		expect(sessions.panes().state.byWorkSession[SESSION.id]?.panes).toEqual([]);
		expect(exited).toEqual([
			{ workSessionId: SESSION.id, terminalId: "a", exitCode: 0, exitSignal: null },
		]);
		expect(fake.close).toHaveBeenCalledWith({ sessionId: "ses_origin", terminalId: "a" }, true);
	});

	it("closes a shell that exits without a pane", async () => {
		const { fake } = await boot();

		fake.deps!.onSessionExited(
			{ sessionId: "gone", terminalId: "a" },
			{ exitCode: 1, exitSignal: null },
		);
		await flush();

		expect(fake.close).toHaveBeenCalledWith({ sessionId: "gone", terminalId: "a" }, true);
	});

	it("titles the pane with the terminal's label", async () => {
		const { workSessions: sessions, fake } = await boot({
			panes: { [SESSION.id]: { ...EMPTY_WORK_SESSION_PANES, panes: [terminalPane("a")] } },
		});
		const title = () => sessions.panes().state.byWorkSession[SESSION.id]?.panes[0]?.title;

		fake.deps!.onLabelChanged({ sessionId: SESSION.id, terminalId: "a" }, "vite");
		await vi.waitFor(() => expect(title()).toBe("vite"));
		fake.deps!.onLabelChanged({ sessionId: SESSION.id, terminalId: "a" }, "Terminal 1");
		await vi.waitFor(() => expect(title()).toBe("Terminal 1"));
		fake.deps!.onLabelChanged({ sessionId: SESSION.id, terminalId: "missing" }, "vim");
	});

	it("lists, reads and closes a work session's terminals", async () => {
		const readout: TerminalReadout = {
			status: "running",
			label: "vite",
			cwd: "/workspace",
			exitCode: null,
			exitSignal: null,
			text: "ready",
			lineCount: 1,
			truncated: false,
		};
		const { fake, terminals } = await boot({
			panes: {
				[SESSION.id]: {
					...EMPTY_WORK_SESSION_PANES,
					panes: [
						{ ...terminalPane("a"), title: "vite" },
						terminalPane("b", { terminalSessionId: "ses_origin" }),
						{ ...terminalPane("c"), kind: "kilo.git/changes" },
					],
				},
			},
		});
		fake.isRunning.mockImplementation((identity) => identity.terminalId === "a");
		fake.read.mockResolvedValue(readout);

		await expect(terminals.methods.list({ workSessionId: SESSION.id })).resolves.toEqual([
			{ terminalId: "a", title: "vite", running: true },
			{ terminalId: "b", title: "Terminal", running: false },
		]);
		await expect(terminals.methods.list({ workSessionId: "other" })).resolves.toEqual([]);

		await expect(
			terminals.methods.read({ workSessionId: SESSION.id, terminalId: "b", lines: 5 }),
		).resolves.toEqual(readout);
		expect(fake.read).toHaveBeenLastCalledWith({ sessionId: "ses_origin", terminalId: "b" }, 5);
		await terminals.methods.read({ workSessionId: SESSION.id, terminalId: "a" });
		expect(fake.read).toHaveBeenLastCalledWith({ sessionId: SESSION.id, terminalId: "a" }, 200);
		await expect(
			terminals.methods.read({ workSessionId: SESSION.id, terminalId: "c" }),
		).resolves.toBeNull();
		await expect(
			terminals.methods.read({ workSessionId: SESSION.id, terminalId: "a", lines: 5_000 }),
		).rejects.toMatchObject({ code: "VALIDATION" });

		await terminals.methods.close({ workSessionId: SESSION.id, terminalId: "b" });
		expect(fake.close).toHaveBeenLastCalledWith(
			{ sessionId: "ses_origin", terminalId: "b" },
			false,
		);
		await terminals.methods.close({ workSessionId: "loose", terminalId: "z", deleteHistory: true });
		expect(fake.close).toHaveBeenLastCalledWith({ sessionId: "loose", terminalId: "z" }, true);
	});

	it("starts terminals only in folders kilo.work-sessions authorises", async () => {
		const primary = await tempDir("terminal-primary-");
		const elsewhere = await tempDir("terminal-elsewhere-");
		const { fake } = await boot({ primary });

		await expect(fake.deps!.resolveCwd(primary)).resolves.toBe(primary);
		await expect(fake.deps!.resolveCwd(elsewhere)).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(fake.deps!.resolveCwd()).resolves.toBe(await realpath(os.tmpdir()));
	});

	it("attaches a port a window opens, and refuses invalid ones", async () => {
		const { renderer, fake } = await boot();
		const args = {
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
			sessionId: SESSION.id,
			terminalId: "a",
			cols: 80,
			rows: 24,
			initialLabel: "Terminal 1",
		};

		renderer.sdkFor("kilo.terminal").ports.open("session", args);
		await vi.waitFor(() => expect(fake.attach).toHaveBeenCalledOnce());
		expect(fake.attach.mock.calls[0]![1]).toEqual(args);

		const refused = renderer.sdkFor("kilo.terminal").ports.open("session", { ...args, cols: 1 });
		const message = new Promise((resolve) => {
			refused.addEventListener("message", (event) => resolve(event.data), { once: true });
			refused.start();
		});
		await expect(message).resolves.toEqual({
			type: "error",
			message: "Invalid terminal connection.",
		});
		expect(fake.attach).toHaveBeenCalledOnce();
	});

	it("streams a shell to a window over its port", async () => {
		const storageDir = await tempDir("terminal-storage-");
		const process = new FakeProcess();
		const { renderer } = await boot({
			storageDir,
			manager: (deps) =>
				new TerminalSessionManager({
					...deps,
					adapter: { spawn: () => process },
					env: { SHELL: "/bin/sh" },
					platform: "linux",
					killGraceMs: 1,
					persistDebounceMs: 1,
					inspectForegroundProcess: async () => null,
				}),
		});
		const port = renderer.sdkFor("kilo.terminal").ports.open("session", {
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
			sessionId: SESSION.id,
			terminalId: "a",
			cols: 80,
			rows: 24,
			initialLabel: "Terminal 1",
		});
		const received: unknown[] = [];
		port.addEventListener("message", (event) => received.push(event.data));
		port.start();

		await vi.waitFor(() => expect(received).toContainEqual({ type: "status", status: "running" }));
		port.postMessage({ type: "input", requestId: "r1", data: "ls\r" });
		await vi.waitFor(() => expect(process.writes).toEqual(["ls\r"]));
		process.emit("hello\r\n");
		await vi.waitFor(() => expect(received).toContainEqual({ type: "output", data: "hello\r\n" }));
		expect(received[0]).toMatchObject({ type: "snapshot", label: "Terminal 1" });
	});

	it("imports origin's transcripts once, without overwriting newer ones", async () => {
		const storageDir = await tempDir("terminal-storage-");
		const originDir = await tempDir("terminal-origin-");
		await mkdir(path.join(originDir, "history"));
		await writeFile(historyPath(originDir, "ses_origin", "a"), "origin a");
		await writeFile(historyPath(originDir, SESSION.id, "b"), "origin b");
		await mkdir(path.join(storageDir, "history"));
		await writeFile(historyPath(storageDir, SESSION.id, "b"), "newer b");

		const { storage } = await boot({ storageDir, originStorageDir: originDir });

		await vi.waitFor(() =>
			expect(storage.saved.get("terminal")).toEqual({ importedFromOrigin: true }),
		);
		await expect(readFile(historyPath(storageDir, "ses_origin", "a"), "utf8")).resolves.toBe(
			"origin a",
		);
		await expect(readFile(historyPath(storageDir, SESSION.id, "b"), "utf8")).resolves.toBe(
			"newer b",
		);
	});

	it("counts a missing origin folder as imported, and retries a failed import next launch", async () => {
		const storageDir = await tempDir("terminal-storage-");
		const missing = await boot({ storageDir, originStorageDir: path.join(storageDir, "none") });
		await vi.waitFor(() =>
			expect(missing.storage.saved.get("terminal")).toEqual({ importedFromOrigin: true }),
		);

		const blocked = await tempDir("terminal-storage-");
		await writeFile(path.join(blocked, "history"), "not a folder");
		const originDir = await tempDir("terminal-origin-");
		await mkdir(path.join(originDir, "history"));
		await writeFile(historyPath(originDir, SESSION.id, "a"), "origin a");
		const failed = await boot({ storageDir: blocked, originStorageDir: originDir });
		await flush();
		await flush();
		expect(failed.storage.saved.get("terminal")).toBeUndefined();
	});
});

class FakeProcess implements PtyProcess {
	readonly pid = 42;
	readonly writes: string[] = [];
	#data = new Set<(data: string) => void>();
	write(data: string) {
		this.writes.push(data);
	}
	resize() {}
	kill() {}
	onData(listener: (data: string) => void) {
		this.#data.add(listener);
		return () => void this.#data.delete(listener);
	}
	onExit(_listener: (event: PtyExitEvent) => void) {
		return () => undefined;
	}
	emit(data: string) {
		for (const listener of this.#data) listener(data);
	}
}

describe("kilo.terminal's agent tools", () => {
	const readout: TerminalReadout = {
		status: "running",
		label: "npm run dev",
		cwd: "/work",
		exitCode: null,
		exitSignal: null,
		text: "ready on :3000",
		lineCount: 1,
		truncated: false,
	};

	const context = (workSessionId: string | null): ToolCallContext => ({
		workSessionId,
		workspaceId: null,
		chatId: workSessionId ? "ses_chat" : null,
		callId: workSessionId ? "call_1" : null,
		external: workSessionId === null,
		signal: new AbortController().signal,
	});

	async function bootWithTools(panes: Record<string, WorkSessionPanes> = {}) {
		const booted = await boot({ panes });
		const tools = booted.main.kernelSdk.extensions.list(Tool);
		const call = async (id: string, input: unknown, sessionId: string | null) => {
			const tool = tools.find((contribution) => contribution.id === id)!;
			return tool.implementation!.run(tool.implementation!.input.parse(input), context(sessionId));
		};
		return { ...booted, tools, call };
	}

	it("contributes open, list and read, read-only where they only look", async () => {
		const { tools } = await bootWithTools();

		expect(tools.map((tool) => [tool.key, tool.metadata.title, tool.metadata.readOnly])).toEqual([
			["kilo.terminal/open", "Open terminal", false],
			["kilo.terminal/list", "List terminals", true],
			["kilo.terminal/read", "Read terminal", true],
		]);
		expect(tools.every((tool) => tool.metadata.external && !tool.metadata.requiresSignIn)).toBe(
			true,
		);
	});

	it("opens a terminal pane in the calling chat's work session", async () => {
		const { call, workSessions: sessions } = await bootWithTools();

		await expect(call("open", {}, SESSION.id)).resolves.toEqual({
			workSessionId: SESSION.id,
			terminalId: "pane_1",
			title: "Terminal",
		});
		expect(
			sessions.panes().state.byWorkSession[SESSION.id]?.panes.map((pane) => pane.kind),
		).toEqual(["kilo.terminal/terminal"]);
	});

	it("lists the work session's terminals with what they run", async () => {
		const { call, fake } = await bootWithTools({
			[SESSION.id]: {
				...EMPTY_WORK_SESSION_PANES,
				panes: [
					terminalPane("a"),
					terminalPane("b"),
					{ ...terminalPane("c"), kind: "kilo.git/changes" },
				],
			},
		});
		fake.read.mockImplementation(async (identity: { terminalId: string }) =>
			identity.terminalId === "a" ? readout : null,
		);

		await expect(call("list", {}, SESSION.id)).resolves.toEqual({
			workSessionId: SESSION.id,
			terminals: [
				{
					terminalId: "a",
					title: "Terminal",
					status: "running",
					runningProcess: "npm run dev",
					cwd: "/work",
				},
				{ terminalId: "b", title: "Terminal" },
			],
		});
		expect(fake.read).toHaveBeenCalledWith({ sessionId: SESSION.id, terminalId: "a" }, 0);
	});

	it("lists an exited terminal's exit code, and survives a terminal it can't read", async () => {
		const { call, fake } = await bootWithTools({
			[SESSION.id]: { ...EMPTY_WORK_SESSION_PANES, panes: [terminalPane("a"), terminalPane("b")] },
		});
		fake.read.mockImplementation(async (identity: { terminalId: string }) => {
			if (identity.terminalId === "b") throw new Error("gone");
			return { ...readout, status: "exited" as const, label: null, cwd: null, exitCode: 2 };
		});

		await expect(call("list", {}, SESSION.id)).resolves.toEqual({
			workSessionId: SESSION.id,
			terminals: [
				{ terminalId: "a", title: "Terminal", status: "exited", exitCode: 2 },
				{ terminalId: "b", title: "Terminal" },
			],
		});
	});

	it("reads a terminal's recent output", async () => {
		const { call, fake } = await bootWithTools({
			[SESSION.id]: { ...EMPTY_WORK_SESSION_PANES, panes: [terminalPane("a")] },
		});
		fake.read.mockResolvedValue(readout);

		await expect(call("read", { terminalId: "a", lines: 20 }, SESSION.id)).resolves.toEqual({
			terminalId: "a",
			title: "Terminal",
			status: "running",
			runningProcess: "npm run dev",
			cwd: "/work",
			exitCode: null,
			exitSignal: null,
			lineCount: 1,
			truncated: false,
			output: "ready on :3000",
		});
		expect(fake.read).toHaveBeenLastCalledWith({ sessionId: SESSION.id, terminalId: "a" }, 20);
		await call("read", { terminalId: "a" }, SESSION.id);
		expect(fake.read).toHaveBeenLastCalledWith({ sessionId: SESSION.id, terminalId: "a" }, 200);
	});

	it("refuses to read a terminal outside the work session, or one with no output", async () => {
		const { call } = await bootWithTools({
			[SESSION.id]: { ...EMPTY_WORK_SESSION_PANES, panes: [terminalPane("a")] },
		});

		await expect(call("read", { terminalId: "z" }, SESSION.id)).rejects.toThrow(
			'No terminal "z" in this chat. Call terminal_list first.',
		);
		await expect(call("read", { terminalId: "a" }, SESSION.id)).rejects.toThrow(
			"This terminal has no output yet.",
		);
	});

	it("refuses every call without a calling chat's work session", async () => {
		const { call } = await bootWithTools();

		for (const [id, input] of [
			["open", {}],
			["list", {}],
			["read", { terminalId: "a" }],
		] as const) {
			await expect(call(id, input, null)).rejects.toThrow(
				"Terminal tools require an originating Kilo chat session",
			);
		}
	});
});

describe("kilo.terminal shell profiles", () => {
	const FISH: TerminalProfile = {
		id: "detected:fish",
		label: "fish",
		path: "/opt/homebrew/bin/fish",
		args: [],
		source: "detected",
		available: true,
	};

	function shells(found: TerminalProfile[] = [FISH]) {
		return {
			detect: vi.fn(async (_custom: readonly CustomTerminalProfile[]) => found),
			automatic: vi.fn(async () => [{ shell: "/bin/sh", args: [] }]),
		};
	}

	it("publishes the detected profiles and the settings once activated", async () => {
		const { terminals } = await boot({ shells: shells() });

		await vi.waitFor(() => expect(terminals.getState().profiles).toEqual([FISH]));
		expect(terminals.getState().settings).toEqual({ defaultProfileId: null, customProfiles: [] });
	});

	it("saves settings and publishes them, listing a custom profile whose shell is missing", async () => {
		const { terminals } = await boot({ shells: shells() });
		const settings = {
			defaultProfileId: "nu",
			customProfiles: [{ id: "nu", label: "Nushell", path: "/nowhere/nu" }],
		};

		await expect(terminals.methods.updateSettings(settings)).resolves.toEqual(settings);
		expect(terminals.getState().settings).toEqual(settings);
		await vi.waitFor(() =>
			expect(terminals.getState().profiles).toEqual([
				FISH,
				{
					id: "nu",
					label: "Nushell",
					path: "/nowhere/nu",
					args: [],
					source: "custom",
					available: false,
				},
			]),
		);
	});

	it("detects again on request", async () => {
		const discovery = shells();
		const { terminals } = await boot({ shells: discovery });
		await vi.waitFor(() => expect(discovery.detect).toHaveBeenCalledTimes(1));
		const ZSH = { ...FISH, id: "detected:zsh", label: "zsh", path: "/bin/zsh" };
		discovery.detect.mockResolvedValue([FISH, ZSH]);

		await expect(terminals.methods.refreshProfiles(undefined)).resolves.toEqual([FISH, ZSH]);
		expect(terminals.getState().profiles).toEqual([FISH, ZSH]);
	});

	it("starts shells with the default profile first", async () => {
		const { fake, terminals } = await boot({ shells: shells() });

		await expect(fake.deps!.resolveLaunch()).resolves.toEqual([{ shell: "/bin/sh", args: [] }]);
		await terminals.methods.updateSettings({ defaultProfileId: "detected:fish" });
		await expect(fake.deps!.resolveLaunch()).resolves.toEqual([
			{ shell: "/opt/homebrew/bin/fish", args: [] },
			{ shell: "/bin/sh", args: [] },
		]);
	});

	it("warns, and keeps working, when detection fails", async () => {
		const { logger, warnings } = recordingLogger();
		const discovery = shells();
		discovery.detect.mockRejectedValue(new Error("probe crashed"));
		const { terminals } = await boot({ shells: discovery, logger });

		await vi.waitFor(() =>
			expect(warnings.some(([message]) => String(message).includes("probe crashed"))).toBe(true),
		);
		expect(terminals.getState().profiles).toEqual([]);
	});
});
