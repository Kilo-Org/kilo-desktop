import { beforeEach, describe, expect, it, vi } from "vitest";

const { contextBridge, ipcRenderer } = vi.hoisted(() => ({
	contextBridge: {
		exposeInMainWorld: vi.fn(),
	},
	ipcRenderer: {
		invoke: vi.fn(),
		on: vi.fn(),
		removeListener: vi.fn(),
	},
}));

vi.mock("electron", () => ({
	contextBridge,
	ipcRenderer,
}));

describe("preload desktopApi", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("forwards allowed invoke channels and rejects unknown ones", async () => {
		ipcRenderer.invoke.mockResolvedValue({ ok: true, value: [] });
		await import("./preload.js");
		const desktopApi = contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
			invoke: (channel: string, input?: unknown) => Promise<unknown>;
			on: (channel: string, listener: (payload: unknown) => void) => () => void;
		};

		await expect(desktopApi.invoke("theme:get")).resolves.toEqual({ ok: true, value: [] });
		expect(ipcRenderer.invoke).toHaveBeenCalledWith("theme:get", undefined);

		expect(() => desktopApi.invoke("theme:unknown" as never)).toThrow(
			"Unknown IPC method channel.",
		);
	});

	it("validates event payloads and cleans up listeners", async () => {
		await import("./preload.js");
		const desktopApi = contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
			on: (channel: string, listener: (payload: unknown) => void) => () => void;
		};

		const listener = vi.fn();
		const unsubscribe = desktopApi.on("theme:changed", listener);
		const handler = ipcRenderer.on.mock.calls[0]?.[1] as (event: unknown, payload: unknown) => void;

		handler({}, { source: "dark", shouldUseDarkColors: true });
		expect(listener).toHaveBeenCalledWith({ source: "dark", shouldUseDarkColors: true });

		handler({}, { source: "nope" });
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		expect(ipcRenderer.removeListener).toHaveBeenCalledWith("theme:changed", handler);
	});
});
