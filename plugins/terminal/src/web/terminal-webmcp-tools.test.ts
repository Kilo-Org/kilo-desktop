import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { terminalContract, type TerminalReadout } from "../contracts/session.js";
import { webRegister } from "./index.js";

type Tab = {
	instanceId: string;
	definitionId: string;
	title: string;
	ordinal: number | null;
	metadata?: Readonly<Record<string, string>>;
};

const VITE_TAB: Tab = {
	instanceId: "terminal-1",
	definitionId: "terminal.terminal",
	title: "vite",
	ordinal: 1,
	metadata: { terminalSessionId: "local-chat-1" },
};
const SHELL_TAB: Tab = {
	instanceId: "terminal-2",
	definitionId: "terminal.terminal",
	title: "Terminal 2",
	ordinal: 2,
};
const FILES_TAB: Tab = {
	instanceId: "files-1",
	definitionId: "files.files",
	title: "Files",
	ordinal: null,
};

const READOUT: TerminalReadout = {
	status: "running",
	label: "vite",
	cwd: "/workspace",
	exitCode: null,
	exitSignal: null,
	text: "error TS2345: bad type",
	lineCount: 1,
	truncated: true,
};

function makeSystem(options: { withKiloUi?: boolean; tabs?: Tab[] } = {}) {
	const read = vi.fn(async (): Promise<TerminalReadout | null> => READOUT);
	const terminalSdk = createFakeSdk({
		featureId: "terminal",
		channels: terminalContract,
		handlers: { close: async () => undefined, read },
	});
	const system = createFakeFeatureSystem({ sdks: { terminal: terminalSdk } });
	const panel = {
		listTabs: vi.fn((sessionId: string) =>
			sessionId === "chat-1" ? (options.tabs ?? [VITE_TAB, SHELL_TAB, FILES_TAB]) : [],
		),
		openContributedTab: vi.fn(() => ({ instanceId: "terminal-new", title: "Terminal 3" })),
		updateTab: vi.fn(),
		closeTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => () => {}),
	};
	if (options.withKiloUi !== false) {
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", panel);
	}
	webRegister(terminalSdk);
	const invoke = (
		name: string,
		args: Record<string, unknown> = {},
		kiloSessionId: string | null = "chat-1",
	) =>
		system.services.toolRegistry.invoke(
			"terminal",
			name,
			args,
			kiloSessionId ? { kiloSessionId } : {},
		);
	return { system, panel, read, invoke };
}

describe("terminal_open WebMCP tool", () => {
	it("is exposed to the model and promises not to run commands", () => {
		const { system } = makeSystem();

		const tool = system.services.toolRegistry.all().find((entry) => entry.id === "terminal.open");
		expect(tool?.exposeToModelContext).toBe(true);
		expect(tool?.description).toMatch(/does not run commands/i);
		expect(tool?.inputSchema).toMatchObject({ properties: {} });
	});

	it("opens a new Terminal tab in the calling chat, ignoring any command", async () => {
		const { panel, invoke } = makeSystem();

		await expect(invoke("open", { command: "rm -rf ~" })).resolves.toEqual({
			sessionId: "chat-1",
			instanceId: "terminal-new",
			title: "Terminal 3",
		});
		expect(panel.openContributedTab).toHaveBeenCalledWith("chat-1", {
			id: "terminal.terminal",
			title: "Terminal",
		});
	});

	it("requires an originating Kilo chat session", async () => {
		const { panel, invoke } = makeSystem();

		await expect(invoke("open", {}, null)).resolves.toEqual({
			error: expect.stringContaining("originating Kilo chat session"),
		});
		expect(panel.openContributedTab).not.toHaveBeenCalled();
	});

	it("reports when the chat UI is unavailable", async () => {
		const { invoke } = makeSystem({ withKiloUi: false });

		await expect(invoke("open")).resolves.toEqual({
			error: expect.stringContaining("unavailable"),
		});
	});
});

describe("terminal_list WebMCP tool", () => {
	it("lists the chat's terminals with their status", async () => {
		const { read, invoke } = makeSystem();
		read.mockResolvedValueOnce(READOUT).mockResolvedValueOnce(null);

		await expect(invoke("list")).resolves.toEqual({
			sessionId: "chat-1",
			terminals: [
				{
					terminalId: "terminal-1",
					title: "vite",
					status: "running",
					runningProcess: "vite",
					cwd: "/workspace",
				},
				{ terminalId: "terminal-2", title: "Terminal 2" },
			],
		});
		expect(read).toHaveBeenCalledWith({
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
			lines: 0,
		});
		expect(read).toHaveBeenCalledWith({ sessionId: "chat-1", terminalId: "terminal-2", lines: 0 });
	});

	it("is read-only and exposed to the model", () => {
		const { system } = makeSystem();

		const tool = system.services.toolRegistry.all().find((entry) => entry.id === "terminal.list");
		expect(tool?.exposeToModelContext).toBe(true);
		expect(tool?.annotations?.readOnlyHint).toBe(true);
	});
});

describe("terminal_read WebMCP tool", () => {
	it("returns plain-text output of a terminal in the calling chat", async () => {
		const { read, invoke } = makeSystem();

		await expect(invoke("read", { terminalId: "terminal-1", lines: 50 })).resolves.toEqual({
			terminalId: "terminal-1",
			title: "vite",
			status: "running",
			runningProcess: "vite",
			cwd: "/workspace",
			exitCode: null,
			exitSignal: null,
			lineCount: 1,
			truncated: true,
			output: "error TS2345: bad type",
		});
		expect(read).toHaveBeenCalledWith({
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
			lines: 50,
		});
	});

	it("defaults to the last 200 lines", async () => {
		const { read, invoke } = makeSystem();

		await invoke("read", { terminalId: "terminal-1" });

		expect(read).toHaveBeenCalledWith(expect.objectContaining({ lines: 200 }));
	});

	it("refuses terminals outside the calling chat", async () => {
		const { read, invoke } = makeSystem();

		await expect(invoke("read", { terminalId: "files-1" })).resolves.toEqual({
			error: expect.stringContaining("No terminal"),
		});
		await expect(invoke("read", { terminalId: "terminal-1" }, "other-chat")).resolves.toEqual({
			error: expect.stringContaining("No terminal"),
		});
		expect(read).toHaveBeenCalledTimes(0);
	});

	it("reports a terminal with no saved output", async () => {
		const { read, invoke } = makeSystem();
		read.mockResolvedValueOnce(null);

		await expect(invoke("read", { terminalId: "terminal-1" })).resolves.toEqual({
			error: expect.stringContaining("no output"),
		});
	});

	it("warns the model that output is untrusted", () => {
		const { system } = makeSystem();

		const tool = system.services.toolRegistry.all().find((entry) => entry.id === "terminal.read");
		expect(tool?.description).toMatch(/untrusted/i);
		expect(tool?.annotations?.readOnlyHint).toBe(true);
	});

	it("rejects oversized reads", async () => {
		const { invoke } = makeSystem();

		await expect(invoke("read", { terminalId: "terminal-1", lines: 10_000 })).rejects.toThrow();
	});
});
