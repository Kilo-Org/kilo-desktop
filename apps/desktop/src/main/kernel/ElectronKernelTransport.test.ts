import { beforeEach, describe, expect, it, vi } from "vitest";

const { isTrustedIpcSender } = vi.hoisted(() => ({ isTrustedIpcSender: vi.fn(() => true) }));

vi.mock("electron", () => ({ ipcMain: {} }));
vi.mock("../platform/ElectronSecurity.js", () => ({ isTrustedIpcSender }));

import { KernelError } from "@kilo-desktop/kernel";

import { ElectronKernelTransport, KERNEL_IPC } from "./ElectronKernelTransport.js";

function fakeIpcMain() {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const listeners = new Map<string, (...args: unknown[]) => void>();
	return {
		handlers,
		listeners,
		handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(channel, handler);
		}),
		removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
		on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
			listeners.set(channel, listener);
		}),
		removeListener: vi.fn(),
	};
}

function fakeContents(id: number) {
	return { id, send: vi.fn(), isDestroyed: () => false };
}

describe("ElectronKernelTransport", () => {
	beforeEach(() => {
		isTrustedIpcSender.mockReturnValue(true);
	});

	function setup() {
		const ipcMain = fakeIpcMain();
		const transport = new ElectronKernelTransport(ipcMain as never);
		transport.install();
		const main = fakeContents(1);
		const second = fakeContents(2);
		transport.attachWindow("main", main as never);
		transport.attachWindow("w2", second as never);
		return { ipcMain, transport, main, second };
	}

	it("routes requests from a known window to the handler with the window as origin", async () => {
		const { ipcMain, transport } = setup();
		transport.handle("demo", (payload, from) => ({ payload, from }));

		const result = await ipcMain.handlers.get(KERNEL_IPC.request)!(
			{ sender: { id: 2 } },
			{ channel: "demo", payload: 42 },
		);

		expect(result).toEqual({
			ok: true,
			value: { payload: 42, from: { process: "renderer", windowId: "w2" } },
		});
	});

	it("rejects requests from untrusted or unknown senders", async () => {
		const { ipcMain, transport } = setup();
		transport.handle("demo", () => "secret");

		isTrustedIpcSender.mockReturnValueOnce(false);
		await expect(
			ipcMain.handlers.get(KERNEL_IPC.request)!({ sender: { id: 1 } }, { channel: "demo" }),
		).resolves.toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
		await expect(
			ipcMain.handlers.get(KERNEL_IPC.request)!({ sender: { id: 99 } }, { channel: "demo" }),
		).resolves.toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
	});

	it("keeps expected errors and scrubs unexpected ones", async () => {
		const { ipcMain, transport } = setup();
		transport.handle("expected", () => {
			throw new KernelError("NOT_FOUND", "Nope.");
		});
		transport.handle("unexpected", () => {
			throw new Error("stack trace with secrets");
		});
		const request = ipcMain.handlers.get(KERNEL_IPC.request)!;

		await expect(request({ sender: { id: 1 } }, { channel: "expected" })).resolves.toEqual({
			ok: false,
			error: { code: "NOT_FOUND", message: "Nope." },
		});
		await expect(request({ sender: { id: 1 } }, { channel: "unexpected" })).resolves.toEqual({
			ok: false,
			error: { code: "INTERNAL", message: "The operation failed." },
		});
	});

	it("broadcasts, targets and excludes windows when sending", () => {
		const { transport, main, second } = setup();

		transport.send("all", 1);
		transport.send("one", 2, { toWindow: "w2" });
		transport.send("others", 3, { exceptWindow: "w2" });

		expect(main.send.mock.calls).toEqual([
			[KERNEL_IPC.event, { channel: "all", payload: 1 }],
			[KERNEL_IPC.event, { channel: "others", payload: 3 }],
		]);
		expect(second.send.mock.calls).toEqual([
			[KERNEL_IPC.event, { channel: "all", payload: 1 }],
			[KERNEL_IPC.event, { channel: "one", payload: 2 }],
		]);
	});

	it("delivers messages from windows to listeners, and stops after the window detaches", () => {
		const { ipcMain, transport } = setup();
		const received: unknown[] = [];
		transport.on("ping", (payload, from) => void received.push([payload, from]));
		const message = ipcMain.listeners.get(KERNEL_IPC.message)!;

		message({ sender: { id: 2 } }, { channel: "ping", payload: "hi" });
		transport.detachWindow("w2");
		message({ sender: { id: 2 } }, { channel: "ping", payload: "ignored" });

		expect(received).toEqual([["hi", { process: "renderer", windowId: "w2" }]]);
	});

	/** Mimics MessagePortMain: once started, a message with no listener is lost. */
	const fakePort = () => {
		const listeners = new Map<string, Set<(event: { data: unknown }) => void>>();
		return {
			listeners,
			emit(name: string, data?: unknown) {
				for (const listener of listeners.get(name) ?? []) listener({ data });
			},
			start: vi.fn(),
			close: vi.fn(),
			postMessage: vi.fn(),
			on: vi.fn((name: string, listener: (event: { data: unknown }) => void) => {
				listeners.set(name, (listeners.get(name) ?? new Set()).add(listener));
			}),
			off: vi.fn((name: string, listener: (event: { data: unknown }) => void) => {
				listeners.get(name)?.delete(listener);
			}),
		};
	};

	it("holds messages that arrive before the port handler subscribes", async () => {
		const { ipcMain, transport } = setup();
		let subscribe: (() => void) | undefined;
		transport.onPort((_channel, _payload, port) => {
			subscribe = () => port.onMessage((data) => port.postMessage({ echo: data }));
		});
		const port = fakePort();
		ipcMain.listeners.get(KERNEL_IPC.port)!(
			{ sender: { id: 1 }, ports: [port] },
			{ channel: "acme.term/session" },
		);

		port.emit("message", "early");
		port.emit("message", "also early");
		subscribe!();
		await Promise.resolve();
		port.emit("message", "late");

		expect(port.postMessage.mock.calls).toEqual([
			[{ echo: "early" }],
			[{ echo: "also early" }],
			[{ echo: "late" }],
		]);
	});

	it("notices a close even when the handler never listens for messages", () => {
		const { ipcMain, transport } = setup();
		const closed = vi.fn();
		transport.onPort((_channel, _payload, port) => void port.onClose(closed));
		const port = fakePort();
		ipcMain.listeners.get(KERNEL_IPC.port)!(
			{ sender: { id: 1 }, ports: [port] },
			{ channel: "acme.term/session" },
		);

		expect(port.start).toHaveBeenCalled();
		port.emit("close");
		expect(closed).toHaveBeenCalledOnce();
	});

	it("hands ports from known windows to the port handler, and closes others", () => {
		const { ipcMain, transport } = setup();
		const received: unknown[] = [];
		const onPort = ipcMain.listeners.get(KERNEL_IPC.port)!;

		const early = fakePort();
		onPort({ sender: { id: 1 }, ports: [early] }, { channel: "acme.term/session" });
		expect(early.close).toHaveBeenCalled();

		transport.onPort((channel, payload, port, from) => {
			received.push({ channel, payload, from });
			port.onMessage((data) => port.postMessage({ echo: data }));
		});
		const port = fakePort();
		onPort(
			{ sender: { id: 2 }, ports: [port] },
			{ channel: "acme.term/session", payload: { cols: 80 } },
		);
		port.emit("message", "ls");

		expect(received).toEqual([
			{
				channel: "acme.term/session",
				payload: { cols: 80 },
				from: { process: "renderer", windowId: "w2" },
			},
		]);
		expect(port.start).toHaveBeenCalled();
		expect(port.postMessage).toHaveBeenCalledWith({ echo: "ls" });

		const stranger = fakePort();
		onPort({ sender: { id: 99 }, ports: [stranger] }, { channel: "acme.term/session" });
		expect(stranger.close).toHaveBeenCalled();
		onPort({ sender: { id: 2 }, ports: [] }, { channel: "acme.term/session" });
	});
});
