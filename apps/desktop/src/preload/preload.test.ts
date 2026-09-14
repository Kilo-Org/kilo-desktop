import { beforeEach, describe, expect, it, vi } from "vitest";

// Pay the contracts transform cost at file load so the first dynamic
// `import("./preload.js")` is not racing the default 5s unit timeout when
// turbo is transforming every package at once.
import "@anaconda-agentic-desktop/contracts";

const { contextBridge, ipcRenderer, getPathForFile } = vi.hoisted(() => ({
	contextBridge: {
		exposeInMainWorld: vi.fn(),
	},
	ipcRenderer: {
		invoke: vi.fn(),
		postMessage: vi.fn(),
		send: vi.fn(),
		on: vi.fn(),
		removeListener: vi.fn(),
	},
	getPathForFile: vi.fn(),
}));

vi.mock("electron", () => ({
	contextBridge,
	ipcRenderer,
	webUtils: { getPathForFile },
}));

describe("preload desktopApi", { timeout: 15_000 }, () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.stubGlobal("window", {
			location: { origin: "app://agentic" },
			addEventListener: vi.fn(),
		});
	});

	it("resolves dropped files through the preload-only Electron API", async () => {
		getPathForFile.mockReturnValueOnce("/tmp/project").mockReturnValueOnce("");
		await import("./preload.js");
		const desktopApi = contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
			getPathForFile(file: File): string | null;
		};
		const file = new File([], "project");
		expect(desktopApi.getPathForFile(file)).toBe("/tmp/project");
		expect(desktopApi.getPathForFile(file)).toBeNull();
	});

	it("forwards allowed invoke channels and rejects unknown ones", async () => {
		ipcRenderer.invoke.mockResolvedValue({ ok: true, value: undefined });
		await import("./preload.js");
		const desktopApi = contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
			invoke: (channel: string, input?: unknown) => Promise<unknown>;
			on: (channel: string, listener: (payload: unknown) => void) => () => void;
		};

		await expect(
			desktopApi.invoke("theme:sync", {
				source: "dark",
				themeId: "dracula",
			}),
		).resolves.toEqual({ ok: true, value: undefined });
		expect(ipcRenderer.invoke).toHaveBeenCalledWith("theme:sync", {
			source: "dark",
			themeId: "dracula",
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

	it("validates and sends renderer feature events", async () => {
		await import("./preload.js");
		const desktopApi = contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
			send: (channel: string, payload: unknown) => void;
		};
		const payload = { featureId: "todos", name: "item-added", payload: { id: "1" } };

		desktopApi.send("feature:event", payload);
		expect(ipcRenderer.send).toHaveBeenCalledWith("feature:event", payload);

		expect(() => desktopApi.send("feature:unknown", payload)).toThrow(
			"Unknown IPC message channel.",
		);
		expect(() => desktopApi.send("feature:event", { featureId: "", name: "x" })).toThrow();
	});

	it("transfers only one validated same-window, same-origin feature port", async () => {
		await import("./preload.js");
		const listener = vi.mocked(window.addEventListener).mock.calls[0]?.[1] as (
			event: MessageEvent<unknown>,
		) => void;
		const port = {} as MessagePort;
		const payload = {
			type: "anaconda-agentic-desktop:feature-port",
			featureId: "notebook",
			channel: "host",
			args: { notebookId: "nb-1" },
		};

		listener({
			source: window,
			origin: window.location.origin,
			data: payload,
			ports: [port],
		} as never);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith("feature:port", payload, [port]);

		listener({ source: {}, origin: window.location.origin, data: payload, ports: [port] } as never);
		listener({
			source: window,
			origin: "https://evil.test",
			data: payload,
			ports: [port],
		} as never);
		listener({ source: window, origin: window.location.origin, data: payload, ports: [] } as never);
		listener({
			source: window,
			origin: window.location.origin,
			data: { ...payload, featureId: "" },
			ports: [port],
		} as never);
		expect(ipcRenderer.postMessage).toHaveBeenCalledOnce();
	});
});
