import { beforeEach, describe, expect, it, vi } from "vitest";

const { contextBridge, ipcRenderer } = vi.hoisted(() => ({
	contextBridge: {
		exposeInMainWorld: vi.fn(),
	},
	ipcRenderer: {
		invoke: vi.fn(),
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
		};

		await expect(desktopApi.invoke("todos:list")).resolves.toEqual({ ok: true, value: [] });
		expect(ipcRenderer.invoke).toHaveBeenCalledWith("todos:list", undefined);

		expect(() => desktopApi.invoke("todos:unknown" as never)).toThrow(
			"Unknown IPC method channel.",
		);
	});
});
