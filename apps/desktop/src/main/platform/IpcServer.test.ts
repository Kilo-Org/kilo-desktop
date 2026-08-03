import { beforeEach, describe, expect, it, vi } from "vitest";

const { isTrustedIpcSender } = vi.hoisted(() => ({
	isTrustedIpcSender: vi.fn(() => true),
}));

vi.mock("electron", () => ({ ipcMain: {} }));
vi.mock("./ElectronSecurity.js", () => ({ isTrustedIpcSender }));

import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import { IpcServer } from "./IpcServer.js";

describe("IpcServer one-way messages", () => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const ipcMain = {
		handle: vi.fn(),
		removeHandler: vi.fn(),
		on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
			listeners.set(channel, listener);
		}),
		removeListener: vi.fn(),
	};

	beforeEach(() => {
		listeners.clear();
		vi.clearAllMocks();
		isTrustedIpcSender.mockReturnValue(true);
	});

	it("validates trusted feature events and exposes the sender id", () => {
		const handler = vi.fn();
		const server = new IpcServer(ipcMain as never);
		server.register({} as IpcHandlers, { "feature:event": handler });
		const listener = listeners.get("feature:event")!;
		const event = { sender: { id: 7 } };
		const payload = { featureId: "producer", name: "changed", payload: { id: "1" } };

		listener(event, payload);
		expect(handler).toHaveBeenCalledWith(payload, { senderId: 7 });

		listener(event, { featureId: "", name: "changed" });
		expect(handler).toHaveBeenCalledOnce();

		isTrustedIpcSender.mockReturnValue(false);
		listener(event, payload);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("removes the exact message listener on dispose", () => {
		const server = new IpcServer(ipcMain as never);
		server.register({} as IpcHandlers, { "feature:event": vi.fn() });
		const listener = listeners.get("feature:event")!;

		server.dispose();

		expect(ipcMain.removeListener).toHaveBeenCalledWith("feature:event", listener);
	});
});
