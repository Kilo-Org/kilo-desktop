import { app, session, webContents, type Session, type WebContents } from "electron";

import type {
	HostBrowserController,
	HostBrowserState,
	MainSdkHostBrowser,
} from "@kilo-desktop/feature-sdk";

import { attachContextMenu, type ContextMenuShell } from "./ElectronContextMenu.js";

export const BROWSER_PARTITION = "persist:kilo-desktop-browser";

const ZOOM_LEVELS = [
	0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
] as const;
const MAX_TITLE_LENGTH = 512;
const MAX_ERROR_LENGTH = 512;
const MAX_FAVICON_BYTES = 64 * 1024;
const FAVICON_PROVIDER = "https://www.google.com/s2/favicons";

function nextZoomLevel(current: number, direction: "in" | "out"): number {
	const candidates = direction === "in" ? ZOOM_LEVELS : ZOOM_LEVELS.toReversed();
	return (
		candidates.find((level) =>
			direction === "in" ? level > current + 0.001 : level < current - 0.001,
		) ?? current
	);
}

// Electron inserts `<app name without whitespace>/<app version>` and
// `Electron/<version>` tokens; sites that sniff them may serve degraded variants.
function cleanUserAgent(userAgent: string): string {
	const appToken = `${app.getName().replace(/\s+/g, "")}/${app.getVersion()}`;
	return userAgent
		.replace(/Electron\/\S+\s*/g, "")
		.split(" ")
		.filter((token) => token !== appToken)
		.join(" ");
}

/**
 * Owns the shared persistent guest session and verified WebContents leases.
 * A controller exists only while its exact guest is alive and embedded by a
 * trusted app window; disposing it removes every listener installed here.
 */
export class ElectronBrowserHost implements MainSdkHostBrowser {
	readonly partition = BROWSER_PARTITION;
	#session: Session | undefined;

	constructor(
		private readonly isTrustedEmbedder: (webContentsId: number) => boolean,
		private readonly shell: ContextMenuShell,
	) {}

	initialize(): void {
		if (this.#session) return;
		const browserSession = session.fromPartition(this.partition);
		browserSession.setUserAgent(cleanUserAgent(browserSession.getUserAgent()));
		browserSession.setPermissionRequestHandler((_contents, _permission, callback) => {
			callback(false);
		});
		browserSession.setPermissionCheckHandler(() => false);
		browserSession.webRequest.onBeforeRequest((details, callback) => {
			callback({ cancel: shouldCancelLoopbackRequest(details) });
		});
		this.#session = browserSession;
	}

	attach(webContentsId: number, onState: (state: HostBrowserState) => void): HostBrowserController {
		this.initialize();
		const browserSession = this.#session!;
		const guest = webContents.fromId(webContentsId);
		const embedderId = guest?.hostWebContents?.id;
		if (
			!guest ||
			guest.isDestroyed() ||
			guest.session !== browserSession ||
			embedderId === undefined ||
			!this.isTrustedEmbedder(embedderId)
		) {
			throw new Error("Browser guest is not attached to a trusted application window.");
		}

		let failure: HostBrowserState["failure"];
		let faviconUrl = "";
		let faviconRequest = 0;
		let disposed = false;
		const emit = () => {
			if (disposed || guest.isDestroyed()) return;
			onState(this.#snapshot(guest, failure, faviconUrl));
		};
		const clearFailure = () => {
			failure = undefined;
			emit();
		};
		const updateFavicon = (url: string) => {
			const source = faviconUrlForOrigin(url);
			const request = ++faviconRequest;
			if (!source) {
				faviconUrl = "";
				emit();
				return;
			}
			void loadFaviconDataUrl(browserSession, source).then((dataUrl) => {
				if (disposed || request !== faviconRequest) return;
				faviconUrl = dataUrl;
				emit();
			});
		};
		const navigated = (_event: Electron.Event, url: string) => {
			failure = undefined;
			faviconUrl = "";
			emit();
			updateFavicon(url);
		};
		const failed = (
			_event: Electron.Event,
			code: number,
			description: string,
			_url: string,
			isMainFrame: boolean,
		) => {
			if (code === -3 || !isMainFrame) return;
			failure = { code, description: description.slice(0, MAX_ERROR_LENGTH) };
			emit();
		};
		const blockUnsupportedNavigation = (event: Electron.Event, url: string) => {
			if (!isHttpUrl(url)) event.preventDefault();
		};
		const listeners: ReadonlyArray<readonly [string, (...args: never[]) => void]> = [
			["will-navigate", blockUnsupportedNavigation as (...args: never[]) => void],
			["will-redirect", blockUnsupportedNavigation as (...args: never[]) => void],
			["did-navigate", navigated as (...args: never[]) => void],
			["did-navigate-in-page", navigated as (...args: never[]) => void],
			["page-title-updated", emit],
			["did-start-loading", clearFailure],
			["did-stop-loading", emit],
			["did-fail-load", failed as (...args: never[]) => void],
			["render-process-gone", emit],
			["destroyed", emit],
		];
		for (const [name, listener] of listeners) guest.on(name as never, listener);
		guest.setWindowOpenHandler(({ url }) => {
			if (isHttpUrl(url)) void guest.loadURL(url).catch(() => undefined);
			return { action: "deny" };
		});
		const detachContextMenu = attachContextMenu(guest, {
			isDevelopment: false,
			shell: this.shell,
		});
		emit();
		updateFavicon(guest.getURL());

		const setZoom = (factor: number) => {
			guest.setZoomFactor(factor);
			emit();
		};
		const controller: HostBrowserController = {
			webContentsId,
			navigate: async (url) => {
				// Electron rejects loadURL for superseded/redirected navigations even
				// when the guest successfully commits the destination. Navigation
				// outcome is reported by the lifecycle listeners above instead.
				void guest.loadURL(url).catch(() => undefined);
			},
			goBack: () => {
				if (guest.navigationHistory.canGoBack()) guest.navigationHistory.goBack();
			},
			goForward: () => {
				if (guest.navigationHistory.canGoForward()) guest.navigationHistory.goForward();
			},
			reload: () => guest.reload(),
			hardReload: () => guest.reloadIgnoringCache(),
			zoomIn: () => setZoom(nextZoomLevel(guest.getZoomFactor(), "in")),
			zoomOut: () => setZoom(nextZoomLevel(guest.getZoomFactor(), "out")),
			resetZoom: () => setZoom(1),
			openDevTools: () => {
				if (guest.isDevToolsOpened()) guest.devToolsWebContents?.focus();
				else guest.openDevTools({ mode: "detach" });
			},
			dispose: () => {
				if (disposed) return;
				disposed = true;
				for (const [name, listener] of listeners) guest.off(name as never, listener);
				detachContextMenu();
			},
		};
		return controller;
	}

	#snapshot(
		guest: WebContents,
		failure?: HostBrowserState["failure"],
		faviconUrl = "",
	): HostBrowserState {
		return {
			webContentsId: guest.id,
			url: guest.getURL() === "about:blank" ? "" : guest.getURL(),
			title: guest.getTitle().slice(0, MAX_TITLE_LENGTH),
			faviconUrl,
			loading: guest.isLoading(),
			canGoBack: guest.navigationHistory.canGoBack(),
			canGoForward: guest.navigationHistory.canGoForward(),
			zoomFactor: guest.getZoomFactor(),
			...(failure ? { failure } : {}),
		};
	}
}

function faviconUrlForOrigin(rawUrl: string): string | undefined {
	try {
		const url = new URL(rawUrl);
		if (!url.host || (url.protocol !== "http:" && url.protocol !== "https:")) return undefined;
		return `${FAVICON_PROVIDER}?domain=${encodeURIComponent(url.host)}&sz=32`;
	} catch {
		return undefined;
	}
}

async function loadFaviconDataUrl(browserSession: Session, source: string): Promise<string> {
	if (source.startsWith("data:")) return source.length <= MAX_FAVICON_BYTES * 2 ? source : "";
	try {
		const response = await browserSession.fetch(source);
		const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
		if (!response.ok || !contentType?.startsWith("image/")) return "";
		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_FAVICON_BYTES) return "";
		const bytes = await readLimitedBody(response, MAX_FAVICON_BYTES);
		if (!bytes) return "";
		return `data:${contentType};base64,${bytes.toString("base64")}`;
	} catch {
		return "";
	}
}

async function readLimitedBody(response: Response, limit: number): Promise<Buffer | undefined> {
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) return Buffer.concat(chunks, byteLength);
		byteLength += value.byteLength;
		if (byteLength > limit) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
}

function isHttpUrl(rawUrl: string): boolean {
	try {
		const protocol = new URL(rawUrl).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

// `URL` canonicalizes an IPv4-mapped IPv6 host to `::ffff:<hi>:<lo>` with the
// trailing IPv4 compressed to two hex groups (`::ffff:7f00:1` is `127.0.0.1`).
// Returns the dotted-quad so the whole `127.0.0.0/8` block is matched, not just
// `127.0.0.1`.
function mappedIpv4(hostname: string): string | undefined {
	const groups = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
	if (!groups) return undefined;
	const value = (parseInt(groups[1]!, 16) << 16) | parseInt(groups[2]!, 16);
	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
		".",
	);
}

function isLoopbackUrl(rawUrl: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
	} catch {
		return false;
	}
	// `URL` keeps a trailing dot on names (`localhost.`), so normalize first.
	hostname = hostname.replace(/\.$/, "");
	if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
	if (hostname === "0.0.0.0" || hostname === "::1" || hostname === "::") return true;
	return IPV4_LOOPBACK.test(mappedIpv4(hostname) ?? hostname);
}

/**
 * Blocks a remote page in the browser partition from reaching a loopback daemon
 * as a sub-resource (the embed-and-drive-via-postMessage attack). A top-level
 * navigation to loopback (the user's own dev server) and a loopback sub-resource
 * whose top-frame is itself loopback stay allowed; an unknown embedder fails closed.
 */
export function shouldCancelLoopbackRequest(details: {
	url: string;
	resourceType: string;
	frame?: { top?: { url?: string } | null } | null;
	initiatorOrigin?: string;
}): boolean {
	if (details.resourceType === "mainFrame") return false;
	if (!isLoopbackUrl(details.url)) return false;
	const embedderUrl = details.frame?.top?.url ?? details.initiatorOrigin;
	if (!embedderUrl || embedderUrl === "null") return true;
	return !isLoopbackUrl(embedderUrl);
}
