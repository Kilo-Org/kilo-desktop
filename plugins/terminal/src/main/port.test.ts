import { describe, expect, it, vi } from "vitest";

import { KernelError, type KernelPort } from "@kilo-desktop/kernel";

import { TERMINAL_PROTOCOL_VERSION } from "../contracts/session";
import { createTerminalPortHandler } from "./port";

function fakePort() {
	const port = {
		postMessage: vi.fn(),
		onMessage: vi.fn(() => () => undefined),
		onClose: vi.fn(() => () => undefined),
		close: vi.fn(),
	} satisfies KernelPort;
	return port;
}

const args = {
	protocolVersion: TERMINAL_PROTOCOL_VERSION,
	sessionId: "wses_1",
	terminalId: "pane_1",
	cwd: "/workspace",
	cols: 120,
	rows: 30,
	initialLabel: "Terminal 1",
};
const caller = { pluginId: "kilo.terminal", windowId: "main" };
const logger = { warn: vi.fn() };

describe("the terminal port", () => {
	it("attaches a validated connection once origin's history is in place", async () => {
		let imported!: () => void;
		const ready = new Promise<void>((resolve) => (imported = resolve));
		const attach = vi.fn(async () => undefined);
		const port = fakePort();

		createTerminalPortHandler({ attach }, ready, logger)(port, args, caller);
		await Promise.resolve();
		expect(attach).not.toHaveBeenCalled();
		imported();

		await vi.waitFor(() => expect(attach).toHaveBeenCalledWith(port, args));
		expect(port.close).not.toHaveBeenCalled();
	});

	it("refuses invalid arguments, saying so before closing", () => {
		const attach = vi.fn(async () => undefined);
		const port = fakePort();

		createTerminalPortHandler({ attach }, Promise.resolve(), logger)(
			port,
			{ ...args, protocolVersion: TERMINAL_PROTOCOL_VERSION + 1 },
			caller,
		);

		expect(attach).not.toHaveBeenCalled();
		expect(port.postMessage).toHaveBeenCalledWith({
			type: "error",
			message: "Invalid terminal connection.",
		});
		expect(port.close).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalled();
	});

	it("tells the frame why a terminal couldn't open, then closes", async () => {
		const attach = vi.fn(async () => {
			throw new KernelError("VALIDATION", "Terminal cwd is not a registered primary workspace.");
		});
		const port = fakePort();

		createTerminalPortHandler({ attach }, Promise.resolve(), logger)(port, args, caller);

		await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
		expect(port.postMessage).toHaveBeenCalledWith({
			type: "error",
			message: "Terminal cwd is not a registered primary workspace.",
		});
	});

	it("falls back to a generic reason for non-errors", async () => {
		const attach = vi.fn(() => Promise.reject("nope"));
		const port = fakePort();

		createTerminalPortHandler({ attach }, Promise.resolve(), logger)(port, args, caller);

		await vi.waitFor(() =>
			expect(port.postMessage).toHaveBeenCalledWith({
				type: "error",
				message: "Could not open the terminal.",
			}),
		);
	});
});
