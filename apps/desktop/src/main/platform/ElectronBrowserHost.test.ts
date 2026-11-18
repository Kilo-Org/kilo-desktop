import { realpath } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const { browserSession, guest, sessionFromPartition, webContentsFromId } = vi.hoisted(() => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const browserSession = {
		fetch: vi.fn(),
		getUserAgent: vi.fn(() => "Electron/40.0 Test"),
		setPermissionCheckHandler: vi.fn(),
		setPermissionRequestHandler: vi.fn(),
		setUserAgent: vi.fn(),
		webRequest: { onBeforeRequest: vi.fn() },
		protocol: { handle: vi.fn() },
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
	app: { getName: () => "Kilo Test App", getVersion: () => "0.1.1-beta.2" },
	session: { fromPartition: sessionFromPartition },
	webContents: { fromId: webContentsFromId },
}));

const detachContextMenu = vi.hoisted(() => vi.fn());
const shell = { openExternal: vi.fn(async () => true), copyText: vi.fn() };
vi.mock("./ElectronContextMenu.js", () => ({
	attachContextMenu: vi.fn(() => detachContextMenu),
}));

import { localFileUrl as browserLocalFileUrl } from "@kilo-desktop/plugin-browser/contracts";
import { ElectronBrowserHost, shouldCancelLoopbackRequest } from "./ElectronBrowserHost.js";
import { attachContextMenu } from "./ElectronContextMenu.js";

afterEach(() => {
	vi.clearAllMocks();
	guest.getURL.mockReturnValue("https://example.com/");
	guest.loadURL.mockResolvedValue(undefined);
});

describe("ElectronBrowserHost", () => {
	it("denies website permissions in the shared browser session", () => {
		const host = new ElectronBrowserHost(() => true, shell);
		host.initialize();

		const request = browserSession.setPermissionRequestHandler.mock.calls[0]?.[0];
		const callback = vi.fn();
		request?.(guest, "geolocation", callback);
		expect(callback).toHaveBeenCalledWith(false);
		const check = browserSession.setPermissionCheckHandler.mock.calls[0]?.[0];
		expect(check?.(guest, "clipboard-read")).toBe(false);
	});

	it("presents a plain Chrome user agent to websites", () => {
		browserSession.getUserAgent.mockReturnValueOnce(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) KiloTestApp/0.1.1-beta.2 Chrome/152.0.7977.78 Electron/44.4.1 Safari/537.36",
		);
		const host = new ElectronBrowserHost(() => true, shell);
		host.initialize();

		expect(browserSession.setUserAgent).toHaveBeenCalledWith(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Safari/537.36",
		);
	});

	it("gives leased web pages the native context menu until the lease is disposed", () => {
		const host = new ElectronBrowserHost(() => true, shell);
		const controller = host.attach(42, vi.fn());

		expect(attachContextMenu).toHaveBeenCalledWith(guest, {
			isDevelopment: false,
			shell,
		});
		expect(detachContextMenu).not.toHaveBeenCalled();

		controller.dispose();
		controller.dispose();
		expect(detachContextMenu).toHaveBeenCalledOnce();
	});

	it("blocks unsupported main-frame navigations and redirects", () => {
		const host = new ElectronBrowserHost(() => true, shell);
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

	it("keeps web pages out of local files and local pages off the web", () => {
		const host = new ElectronBrowserHost(() => true, shell);
		host.attach(42, vi.fn());
		const willNavigate = guest.on.mock.calls.find((call) => call[0] === "will-navigate")?.[1];
		const openWindow = guest.setWindowOpenHandler.mock.calls[0]?.[0] as (details: {
			url: string;
		}) => { action: string };
		const blocked = (url: string) => {
			const event = { preventDefault: vi.fn() };
			willNavigate?.(event, url);
			return event.preventDefault.mock.calls.length > 0;
		};
		const localPage = "kilo-file://local/workspace/Chart.html";

		expect(blocked(localPage)).toBe(true);

		guest.getURL.mockReturnValue(localPage);
		expect(blocked("https://evil.example/?data=secret")).toBe(true);
		expect(blocked("kilo-file://local/workspace/about.html")).toBe(false);
		expect(openWindow({ url: "https://evil.example/?data=secret" })).toEqual({ action: "deny" });
		expect(guest.loadURL).not.toHaveBeenCalled();
	});

	it("serves local files only on the browser partition, as the browser plugin authorizes", async () => {
		const host = new ElectronBrowserHost(() => true, shell);
		host.initialize();
		const [scheme, handler] = browserSession.protocol.handle.mock.calls[0] as unknown as [
			string,
			(request: Request) => Promise<Response>,
		];

		expect(scheme).toBe("kilo-file");
		expect((await handler(new Request("kilo-file://local/etc/hosts"))).status).toBe(404);
		const authorize = vi.fn(async () => false);
		host.serveLocalFiles(authorize);
		// A file that exists on every platform, so the request reaches `authorize`.
		const existing = browserLocalFileUrl(import.meta.filename);
		expect((await handler(new Request(existing))).status).toBe(404);
		expect(authorize).toHaveBeenCalledWith(await realpath(import.meta.filename));
	});

	it("allows the user's own top-level navigation to a loopback dev server", () => {
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:5000/",
				resourceType: "mainFrame",
			}),
		).toBe(false);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://localhost:3000/",
				resourceType: "mainFrame",
			}),
		).toBe(false);
	});

	it("cancels loopback sub-resources embedded by a remote top-frame", () => {
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:47830/output-frame",
				resourceType: "subFrame",
				frame: { top: { url: "https://evil.com/" } },
			}),
		).toBe(true);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:47830/blob/abc",
				resourceType: "image",
				frame: { top: { url: "https://wikipedia.org/" } },
			}),
		).toBe(true);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:47830/blob/abc",
				resourceType: "xhr",
				frame: { top: { url: "https://wikipedia.org/" } },
			}),
		).toBe(true);
	});

	it("cancels loopback reached via normalization-evading spellings", () => {
		for (const url of [
			"http://[::ffff:127.0.0.1]:47830/output-frame",
			"http://[::ffff:7f00:1]:47830/output-frame",
			"http://[0:0:0:0:0:ffff:7f00:1]:47830/output-frame",
			"http://[::ffff:127.0.0.2]:47830/output-frame",
			"http://[::ffff:127.1.1.1]:47830/output-frame",
			"http://localhost.:47830/output-frame",
		]) {
			expect(
				shouldCancelLoopbackRequest({
					url,
					resourceType: "subFrame",
					frame: { top: { url: "https://evil.com/" } },
				}),
				`${url} embedded by a remote top-frame must be cancelled`,
			).toBe(true);
		}
	});

	it("allows a loopback dev server loading its own same-origin sub-resources", () => {
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:5000/widget",
				resourceType: "subFrame",
				frame: { top: { url: "http://127.0.0.1:5000/" } },
			}),
		).toBe(false);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:5000/api",
				resourceType: "xhr",
				frame: { top: { url: "http://localhost:5000/" } },
			}),
		).toBe(false);
	});

	it("fails closed when the embedder of a loopback sub-resource is unknown", () => {
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:47830/x",
				resourceType: "subFrame",
			}),
		).toBe(true);
	});

	it("falls back to initiatorOrigin when frame.top.url is unavailable", () => {
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:47830/x",
				resourceType: "subFrame",
				initiatorOrigin: "https://evil.com",
			}),
		).toBe(true);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://127.0.0.1:5000/x",
				resourceType: "subFrame",
				initiatorOrigin: "http://127.0.0.1:5000",
			}),
		).toBe(false);
	});

	it("only polices loopback request URLs", () => {
		expect(
			shouldCancelLoopbackRequest({
				url: "https://example.com/",
				resourceType: "xhr",
				frame: { top: { url: "https://evil.com/" } },
			}),
		).toBe(false);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://93.184.216.34/",
				resourceType: "subFrame",
				frame: { top: { url: "https://evil.com/" } },
			}),
		).toBe(false);
		expect(
			shouldCancelLoopbackRequest({
				url: "http://[::ffff:93.184.216.34]/",
				resourceType: "subFrame",
				frame: { top: { url: "https://evil.com/" } },
			}),
		).toBe(false);
	});

	it("registers an onBeforeRequest listener that applies the narrowed loopback rule", () => {
		const host = new ElectronBrowserHost(() => true, shell);
		host.initialize();

		const onBeforeRequest = browserSession.webRequest.onBeforeRequest.mock.calls[0]?.[0];
		expect(onBeforeRequest).toBeTypeOf("function");

		const cancelled = vi.fn();
		onBeforeRequest?.(
			{
				url: "http://127.0.0.1:47830/output-frame",
				resourceType: "subFrame",
				frame: { top: { url: "https://evil.com/" } },
			},
			cancelled,
		);
		expect(cancelled).toHaveBeenCalledWith({ cancel: true });

		const allowed = vi.fn();
		onBeforeRequest?.({ url: "http://127.0.0.1:5000/", resourceType: "mainFrame" }, allowed);
		expect(allowed).toHaveBeenCalledWith({ cancel: false });
	});

	it("handles rejected popup navigation", async () => {
		guest.loadURL.mockRejectedValueOnce(new Error("superseded"));
		const host = new ElectronBrowserHost(() => true, shell);
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
		const host = new ElectronBrowserHost(() => true, shell);
		host.attach(42, (state) => states.push(state));

		await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
		expect(states.at(-1)?.faviconUrl).toBe("");
	});
});
