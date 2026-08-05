import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { net, protocol } from "electron";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "anaconda-agentic-desktop";
export const DESKTOP_DEVELOPMENT_SCHEME = "anaconda-agentic-desktop-dev";
// Host seam: dynamic loopback connect sources need an explicit plugin permission before this
// can be derived from a future kilo-code plugin manifest.
const KILO_CONNECT_SOURCE = "http://127.0.0.1:*";

/**
 * Path of the self-hosted WebMCP relay widget. The relay `embed.js` first tries to
 * `fetch()` this file to build a `blob:` iframe; under our hardened CSP that path is
 * unusable (its injected inline config script and blob-inherited policy break). We
 * force the alternative same-origin iframe path by returning 404 to the `fetch()`
 * probe (see {@link isRelayWidgetProbe}), so the widget loads as a real document
 * whose inline script is covered by the per-response inline-hash CSP.
 */
const WEBMCP_WIDGET_PATH = "/webmcp/widget.html";

const MIME_TYPES: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export function getDesktopScheme(isDevelopment: boolean): string {
	return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopUrl(isDevelopment: boolean): string {
	return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}/#/`;
}

export function registerDesktopSchemes(): void {
	protocol.registerSchemesAsPrivileged(
		[DESKTOP_PRODUCTION_SCHEME, DESKTOP_DEVELOPMENT_SCHEME].map((scheme) => ({
			scheme,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
			},
		})),
	);
}

/** Loopback WebSocket origins the WebMCP relay widget probes (ports 9333–9348).
 * IPv4 only: Chromium rejects bracketed IPv6 literals (`ws://[::1]:PORT`) as
 * invalid CSP sources, and the relay daemon + injected embed use `127.0.0.1`.
 * Scoped to this range instead of a `:*` wildcard so renderer script cannot open
 * WebSockets to arbitrary local ports. */
const RELAY_WS_SOURCES = Array.from({ length: 9348 - 9333 + 1 }, (_unused, index) => 9333 + index)
	.map((port) => `ws://127.0.0.1:${port}`)
	.join(" ");

export function createContentSecurityPolicy(
	developmentOrigin?: string,
	inlineScriptHashes: readonly string[] = [],
): string {
	const developmentSources = developmentOrigin ? ` ${new URL(developmentOrigin).origin} ws:` : "";
	const trustedInlineScripts = inlineScriptHashes.map((hash) => ` 'sha256-${hash}'`).join("");
	return [
		"default-src 'self'",
		`script-src 'self'${developmentSources}${trustedInlineScripts}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		// `connect-src`: `KILO_CONNECT_SOURCE` reaches the local Kilo server;
		// `RELAY_WS_SOURCES` are the loopback WebSockets the self-hosted WebMCP
		// relay widget uses to reach the `@mcp-b/webmcp-local-relay` daemon.
		`connect-src 'self' ${KILO_CONNECT_SOURCE}${developmentSources} ${RELAY_WS_SOURCES}`,
		// `frame-src 'self'`: the app embeds the WebMCP relay widget in a hidden
		// same-origin iframe. `frame-ancestors 'self'`: the widget response must
		// permit being framed by the same-origin app (a `'none'` here blocks the
		// relay iframe and breaks tool discovery). No cross-origin embedders exist
		// under the custom scheme, so `'self'` still blocks external framing.
		"frame-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"frame-ancestors 'self'",
	].join("; ");
}

export async function resolveRendererPath(
	rendererRoot: string,
	requestPathname: string,
): Promise<string | undefined> {
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(requestPathname);
	} catch {
		return undefined;
	}
	if (decodedPath.includes("\0")) return undefined;

	// Hash SPA: the protocol only serves the shell (`/`) and built assets.
	const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
	const resolvedRoot = path.resolve(rendererRoot);
	const filePath = path.resolve(resolvedRoot, relativePath);
	const rendererPrefix = `${resolvedRoot}${path.sep}`;
	if (filePath !== resolvedRoot && !filePath.startsWith(rendererPrefix)) {
		return undefined;
	}

	try {
		if ((await stat(filePath)).isFile()) return filePath;
	} catch {
		// Missing or unreadable.
	}
	return undefined;
}

function getInlineScriptHashes(document: string): string[] {
	return [...document.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
		([, source]) =>
			createHash("sha256")
				.update(source ?? "")
				.digest("base64"),
	);
}

/**
 * Distinguishes the relay `embed.js` `fetch()` probe of the widget from a real iframe
 * navigation. `fetch()` sends `Sec-Fetch-Dest: empty`; iframe navigations send an
 * iframe/document destination and an HTML-preferring `Accept`. When the fetch-metadata
 * header is unavailable we fall back to the `Accept` header. Returning 404 to the probe
 * makes `embed.js` use its direct same-origin iframe path instead of a blob iframe.
 */
function isRelayWidgetProbe(request: Request): boolean {
	const destination = request.headers.get("Sec-Fetch-Dest");
	if (destination) return destination === "empty";
	const accept = request.headers.get("Accept") ?? "";
	return !accept.includes("text/html");
}

async function withSecurityHeaders(
	response: Response,
	developmentOrigin?: string,
): Promise<Response> {
	const headers = new Headers(response.headers);
	let body: BodyInit | null = response.body;
	let inlineScriptHashes: string[] = [];
	if (headers.get("Content-Type")?.toLowerCase().includes("text/html")) {
		const bytes = await response.arrayBuffer();
		body = bytes;
		inlineScriptHashes = getInlineScriptHashes(new TextDecoder().decode(bytes));
	}
	headers.set(
		"Content-Security-Policy",
		createContentSecurityPolicy(developmentOrigin, inlineScriptHashes),
	);
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export class ElectronProtocol {
	#registeredScheme: string | undefined;

	register(input: {
		readonly isDevelopment: boolean;
		readonly rendererRoot: string;
		readonly developmentOrigin?: string;
	}): void {
		const scheme = getDesktopScheme(input.isDevelopment);
		if (this.#registeredScheme === scheme) return;

		protocol.handle(scheme, async (request) => {
			const requestUrl = new URL(request.url);
			if (requestUrl.host !== DESKTOP_HOST) {
				return withSecurityHeaders(new Response(null, { status: 404 }), input.developmentOrigin);
			}

			// Force the relay widget onto its direct same-origin iframe path (see
			// WEBMCP_WIDGET_PATH) by failing the `embed.js` `fetch()` probe.
			if (requestUrl.pathname === WEBMCP_WIDGET_PATH && isRelayWidgetProbe(request)) {
				return withSecurityHeaders(new Response(null, { status: 404 }), input.developmentOrigin);
			}

			if (input.isDevelopment && input.developmentOrigin) {
				const targetUrl = new URL(
					`${requestUrl.pathname}${requestUrl.search}`,
					input.developmentOrigin,
				);
				const response = await net.fetch(targetUrl.toString(), {
					method: request.method,
				});
				return withSecurityHeaders(response, input.developmentOrigin);
			}

			const filePath = await resolveRendererPath(input.rendererRoot, requestUrl.pathname);
			if (!filePath) {
				return withSecurityHeaders(new Response(null, { status: 404 }), input.developmentOrigin);
			}
			const body = Uint8Array.from(await readFile(filePath));
			return withSecurityHeaders(
				new Response(body, {
					headers: {
						"Content-Type":
							MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
					},
				}),
				input.developmentOrigin,
			);
		});
		this.#registeredScheme = scheme;
	}

	dispose(): void {
		if (!this.#registeredScheme) return;
		protocol.unhandle(this.#registeredScheme);
		this.#registeredScheme = undefined;
	}
}
