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
		ipcRenderer.invoke.mockResolvedValue({ ok: true, value: undefined });
		await import("./preload.js");
		const desktopApi = contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
			invoke: (channel: string, input?: unknown) => Promise<unknown>;
			on: (channel: string, listener: (payload: unknown) => void) => () => void;
		};

		await expect(
			desktopApi.invoke("theme:sync", { source: "dark", shouldUseDarkColors: true }),
		).resolves.toEqual({ ok: true, value: undefined });
		expect(ipcRenderer.invoke).toHaveBeenCalledWith("theme:sync", {
			source: "dark",
			shouldUseDarkColors: true,
		});

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
		const unsubscribe = desktopApi.on("auth:changed", listener);
		const handler = ipcRenderer.on.mock.calls[0]?.[1] as (event: unknown, payload: unknown) => void;

		handler({}, { status: "anonymous" });
		expect(listener).toHaveBeenCalledWith({ status: "anonymous" });

		handler({}, { status: "nope" });
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		expect(ipcRenderer.removeListener).toHaveBeenCalledWith("auth:changed", handler);
	});
});
