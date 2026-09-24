import { afterEach, describe, expect, it, vi } from "vitest";

const { browserSession, guest, sessionFromPartition, webContentsFromId } = vi.hoisted(() => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const browserSession = {
		fetch: vi.fn(),
		getUserAgent: vi.fn(() => "Electron/40.0 Test"),
		setPermissionCheckHandler: vi.fn(),
		setPermissionRequestHandler: vi.fn(),
		setUserAgent: vi.fn(),
	};
	const guest = {
		id: 42,
		hostWebContents: { id: 7 },
		session: browserSession,
		devToolsWebContents: undefined,
		navigationHistory: {
			canGoBack: vi.fn(() => false),
			canGoForward: vi.fn(() => false),
			goBack: vi.fn(),
			goForward: vi.fn(),
		},
		getTitle: vi.fn(() => "Page"),
		getURL: vi.fn(() => "https://example.com/"),
		getZoomFactor: vi.fn(() => 1),
		isDestroyed: vi.fn(() => false),
		isDevToolsOpened: vi.fn(() => false),
		isLoading: vi.fn(() => false),
		loadURL: vi.fn(() => Promise.resolve()),
		on: vi.fn((name: string, listener: (...args: unknown[]) => void) =>
			listeners.set(name, listener),
		),
		off: vi.fn(),
		openDevTools: vi.fn(),
		reload: vi.fn(),
		reloadIgnoringCache: vi.fn(),
		setWindowOpenHandler: vi.fn(),
		setZoomFactor: vi.fn(),
	};
	return {
		browserSession,
		guest,
		sessionFromPartition: vi.fn(() => browserSession),
		webContentsFromId: vi.fn(() => guest),
	};
});

vi.mock("electron", () => ({
	session: { fromPartition: sessionFromPartition },
	webContents: { fromId: webContentsFromId },
}));

const detachContextMenu = vi.hoisted(() => vi.fn());
vi.mock("./ElectronContextMenu.js", () => ({
	attachContextMenu: vi.fn(() => detachContextMenu),
}));

import { ElectronBrowserHost } from "./ElectronBrowserHost.js";
import { attachContextMenu } from "./ElectronContextMenu.js";

afterEach(() => {
	vi.clearAllMocks();
	guest.getURL.mockReturnValue("https://example.com/");
	guest.loadURL.mockResolvedValue(undefined);
});

describe("ElectronBrowserHost", () => {
	it("denies website permissions in the shared browser session", () => {
		const host = new ElectronBrowserHost(() => true);
		host.initialize();

		const request = browserSession.setPermissionRequestHandler.mock.calls[0]?.[0];
		const callback = vi.fn();
		request?.(guest, "geolocation", callback);
		expect(callback).toHaveBeenCalledWith(false);
		const check = browserSession.setPermissionCheckHandler.mock.calls[0]?.[0];
		expect(check?.(guest, "clipboard-read")).toBe(false);
	});

	it("gives leased web pages the native context menu until the lease is disposed", () => {
		const host = new ElectronBrowserHost(() => true);
		const controller = host.attach(42, vi.fn());

		expect(attachContextMenu).toHaveBeenCalledWith(guest, { isDevelopment: false });
		expect(detachContextMenu).not.toHaveBeenCalled();

		controller.dispose();
		controller.dispose();
		expect(detachContextMenu).toHaveBeenCalledOnce();
	});

	it("blocks unsupported main-frame navigations and redirects", () => {
		const host = new ElectronBrowserHost(() => true);
		host.attach(42, vi.fn());

		for (const name of ["will-navigate", "will-redirect"]) {
			const listener = guest.on.mock.calls.find((call) => call[0] === name)?.[1];
			const blocked = { preventDefault: vi.fn() };
			listener?.(blocked, "file:///etc/passwd");
			expect(blocked.preventDefault).toHaveBeenCalledOnce();
			const allowed = { preventDefault: vi.fn() };
			listener?.(allowed, "https://example.com/next");
			expect(allowed.preventDefault).not.toHaveBeenCalled();
		}
	});

	it("handles rejected popup navigation", async () => {
		guest.loadURL.mockRejectedValueOnce(new Error("superseded"));
		const host = new ElectronBrowserHost(() => true);
		host.attach(42, vi.fn());

		const handler = guest.setWindowOpenHandler.mock.calls[0]?.[0];
		expect(handler?.({ url: "https://example.com/popup" })).toEqual({ action: "deny" });
		await vi.waitFor(() => expect(guest.loadURL).toHaveBeenCalledWith("https://example.com/popup"));
	});

	it("cancels oversized favicon responses without a content-length header", async () => {
		const cancelled = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(40_000));
				controller.enqueue(new Uint8Array(40_000));
			},
			cancel: cancelled,
		});
		browserSession.fetch.mockResolvedValueOnce(
			new Response(body, { headers: { "content-type": "image/png" } }),
		);
		const states: { faviconUrl: string }[] = [];
		const host = new ElectronBrowserHost(() => true);
		host.attach(42, (state) => states.push(state));

		await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
		expect(states.at(-1)?.faviconUrl).toBe("");
	});
});
