import { beforeEach, describe, expect, it, vi } from "vitest";

const { isTrustedIpcSender } = vi.hoisted(() => ({
	isTrustedIpcSender: vi.fn(() => true),
}));

vi.mock("electron", () => ({ ipcMain: {} }));
vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));
vi.mock("./ElectronSecurity.js", () => ({ isTrustedIpcSender }));

import type { IpcHandlers } from "@kilo-desktop/contracts";

import { BusinessError } from "./BusinessError.js";
import { IpcServer } from "./IpcServer.js";

describe("IpcServer", () => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const methodHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
	const ipcMain = {
		handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
			methodHandlers.set(channel, handler);
		}),
		removeHandler: vi.fn(),
		on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
			listeners.set(channel, listener);
		}),
		removeListener: vi.fn(),
	};

	beforeEach(() => {
		listeners.clear();
		methodHandlers.clear();
		vi.clearAllMocks();
		isTrustedIpcSender.mockReturnValue(true);
	});

	it("validates method requests and maps handler outcomes to IPC envelopes", async () => {
		const error = new Error("handler failed");
		const logger = { error: vi.fn() };
		const handler = vi
			.fn()
			.mockReturnValueOnce({ opened: true })
			.mockReturnValueOnce({ opened: "yes" })
			.mockRejectedValueOnce(new BusinessError("not allowed"))
			.mockRejectedValueOnce(error);
		const server = new IpcServer(ipcMain as never, logger);
		server.register({ "shell:open-external": handler } as unknown as IpcHandlers);
		const invoke = methodHandlers.get("shell:open-external")!;
		const event = {};

		isTrustedIpcSender.mockReturnValueOnce(false);
		await expect(invoke(event, { url: "https://example.com" })).resolves.toEqual({
			ok: false,
			error: { code: "AUTHORIZATION", message: "The IPC sender is not trusted." },
		});
		await expect(invoke(event, { url: 42 })).resolves.toEqual({
			ok: false,
			error: { code: "VALIDATION", message: "The IPC request payload is invalid." },
		});
		await expect(invoke(event, { url: "https://example.com" })).resolves.toEqual({
			ok: true,
			value: { opened: true },
		});
		await expect(invoke(event, { url: "https://example.com" })).resolves.toEqual({
			ok: false,
			error: { code: "INTERNAL", message: "The IPC handler returned an invalid response." },
		});
		await expect(invoke(event, { url: "https://example.com" })).resolves.toEqual({
			ok: false,
			error: { code: "BUSINESS", message: "not allowed" },
		});
		await expect(invoke(event, { url: "https://example.com" })).resolves.toEqual({
			ok: false,
			error: { code: "INTERNAL", message: "The desktop operation failed." },
		});
		expect(handler).toHaveBeenCalledTimes(4);
		expect(logger.error).toHaveBeenCalledWith("IPC handler failed for shell:open-external", error);
	});

	it("validates trusted feature events and exposes the sender id", () => {
		const handler = vi.fn();
		const server = new IpcServer(ipcMain as never);
		server.register({} as IpcHandlers, { "feature:event": handler, "shortcuts:sync": vi.fn() });
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
		server.register({} as IpcHandlers, { "feature:event": vi.fn(), "shortcuts:sync": vi.fn() });
		const listener = listeners.get("feature:event")!;

		server.dispose();

		expect(ipcMain.removeListener).toHaveBeenCalledWith("feature:event", listener);
		expect(ipcMain.removeHandler).toHaveBeenCalledWith("shell:open-external");
	});

	it("logs message handler failures through the injected logger", () => {
		const error = new Error("relay failed");
		const logger = { error: vi.fn() };
		const server = new IpcServer(ipcMain as never, logger);
		server.register({} as IpcHandlers, {
			"feature:event": () => {
				throw error;
			},
			"shortcuts:sync": vi.fn(),
		});
		const listener = listeners.get("feature:event")!;

		listener(
			{ sender: { id: 7 } },
			{ featureId: "producer", name: "changed", payload: { id: "1" } },
		);

		expect(logger.error).toHaveBeenCalledWith(
			"IPC message handler failed for feature:event",
			error,
		);
	});

	it("routes one validated port from a trusted renderer", async () => {
		const handler = vi.fn();
		const server = new IpcServer(ipcMain as never);
		server.register({} as IpcHandlers, undefined, { "feature:port": handler });
		const listener = listeners.get("feature:port")!;
		const port = { close: vi.fn() };
		const payload = {
			type: "kilo-desktop:feature-port",
			featureId: "notebook",
			channel: "host",
			args: { notebookId: "nb-1" },
		};

		listener({ sender: { id: 7 }, ports: [port] }, payload);
		await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
		expect(handler).toHaveBeenCalledWith(payload, { senderId: 7, port });
		expect(port.close).not.toHaveBeenCalled();
	});

	it("closes rejected or unhandled transferred ports", async () => {
		const error = new Error("no handler");
		const logger = { error: vi.fn() };
		const handler = vi.fn(() => Promise.reject(error));
		const server = new IpcServer(ipcMain as never, logger);
		server.register({} as IpcHandlers, undefined, { "feature:port": handler });
		const listener = listeners.get("feature:port")!;
		const payload = {
			type: "kilo-desktop:feature-port",
			featureId: "notebook",
			channel: "host",
		};

		const invalidPort = { close: vi.fn() };
		listener({ sender: { id: 7 }, ports: [invalidPort] }, { ...payload, featureId: "" });
		expect(invalidPort.close).toHaveBeenCalledOnce();

		const extraPorts = [{ close: vi.fn() }, { close: vi.fn() }];
		listener({ sender: { id: 7 }, ports: extraPorts }, payload);
		expect(extraPorts[0]!.close).toHaveBeenCalledOnce();
		expect(extraPorts[1]!.close).toHaveBeenCalledOnce();

		const untrustedPort = { close: vi.fn() };
		isTrustedIpcSender.mockReturnValueOnce(false);
		listener({ sender: { id: 7 }, ports: [untrustedPort] }, payload);
		expect(untrustedPort.close).toHaveBeenCalledOnce();

		const failedPort = { close: vi.fn() };
		listener({ sender: { id: 7 }, ports: [failedPort] }, payload);
		await vi.waitFor(() => expect(failedPort.close).toHaveBeenCalledOnce());
		expect(logger.error).toHaveBeenCalledWith("IPC port handler failed for feature:port", error);
	});

	it("closes the port when a feature port handler throws synchronously", () => {
		const error = new Error("attach failed");
		const logger = { error: vi.fn() };
		const server = new IpcServer(ipcMain as never, logger);
		server.register({} as IpcHandlers, undefined, {
			"feature:port": () => {
				throw error;
			},
		});
		const port = { close: vi.fn() };

		listeners.get("feature:port")!(
			{ sender: { id: 7 }, ports: [port] },
			{
				type: "kilo-desktop:feature-port",
				featureId: "notebook",
				channel: "host",
			},
		);

		expect(port.close).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith("IPC port handler failed for feature:port", error);
	});
});
