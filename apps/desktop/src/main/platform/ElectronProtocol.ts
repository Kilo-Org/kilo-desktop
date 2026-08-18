import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { net, protocol } from "electron";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	type EmbeddedWebHost,
} from "@anaconda-agentic-desktop/feature-sdk/main";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "anaconda-agentic-desktop";
export const DESKTOP_DEVELOPMENT_SCHEME = "anaconda-agentic-desktop-dev";
// Application policy: renderer features may connect to app-managed loopback servers on
// ephemeral ports. Remote HTTP, localhost aliases, and WebSocket origins remain disallowed.
const LOOPBACK_SERVER_CONNECT_SOURCE = "http://127.0.0.1:*";

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
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
	// Streaming WebAssembly compilation rejects anything but this exact type, so
	// falling through to application/octet-stream breaks streaming compilation.
	".wasm": "application/wasm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export function getDesktopScheme(isDevelopment: boolean): string {
	return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopOrigin(isDevelopment: boolean, host: string = DESKTOP_HOST): string {
	return `${getDesktopScheme(isDevelopment)}://${host}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
	return `${getDesktopOrigin(isDevelopment)}/#/`;
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
	frameOrigins: readonly string[] = [],
): string {
	const developmentSources = developmentOrigin ? ` ${new URL(developmentOrigin).origin} ws:` : "";
	const trustedInlineScripts = inlineScriptHashes.map((hash) => ` 'sha256-${hash}'`).join("");
	return [
		"default-src 'self'",
		`script-src 'self'${developmentSources}${trustedInlineScripts}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		// `connect-src`: `LOOPBACK_SERVER_CONNECT_SOURCE` reaches app-managed
		// loopback servers (e.g. the local Kilo server); `RELAY_WS_SOURCES` are
		// the loopback WebSockets the self-hosted WebMCP relay widget uses to
		// reach the `@mcp-b/webmcp-local-relay` daemon.
		`connect-src 'self' ${LOOPBACK_SERVER_CONNECT_SOURCE}${developmentSources} ${RELAY_WS_SOURCES}`,
		// `frame-src 'self'`: the app embeds the WebMCP relay widget in a hidden
		// same-origin iframe. `frame-ancestors 'self'`: the widget response must
		// permit being framed by the same-origin app (a `'none'` here blocks the
		// relay iframe and breaks tool discovery). No cross-origin embedders exist
		// under the custom scheme, so `'self'` still blocks external framing.
		`frame-src 'self'${frameOrigins.length > 0 ? ` ${frameOrigins.join(" ")}` : ""}`,
		"object-src 'none'",
		"base-uri 'none'",
		"frame-ancestors 'self'",
	].join("; ");
}

/**
 * Policy for an embedded third-party bundle. Deliberately looser than the app's
 * own — and deliberately written here rather than declared by the feature that
 * contributes the bundle, so the party being constrained is not the party
 * choosing the constraint.
 *
 * What the extra grants buy, none of which the app origin gains:
 * - `'wasm-unsafe-eval'`: embedded bundles may instantiate WebAssembly.
 * - loopback HTTP on connect/img/media supports host-authorized local services.
 * - `worker-src blob:` supports embedded bundles that create blob workers.
 */
export function createEmbeddedContentSecurityPolicy(
	appOrigin: string,
	inlineScriptHashes: readonly string[] = [],
): string {
	const trustedInlineScripts = inlineScriptHashes.map((hash) => ` 'sha256-${hash}'`).join("");
	const loopback = "http://127.0.0.1:*";
	return [
		"default-src 'self'",
		`script-src 'self' 'wasm-unsafe-eval'${trustedInlineScripts}`,
		"style-src 'self' 'unsafe-inline'",
		`img-src 'self' data: blob: ${loopback}`,
		"font-src 'self' data:",
		`media-src 'self' data: blob: ${loopback}`,
		`connect-src 'self' ${loopback}`,
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		// The child's own header is what decides whether it can be framed, so the
		// app origin has to be named here — `frame-src` on the parent is not enough.
		`frame-ancestors ${appOrigin}`,
	].join("; ");
}

/**
 * CSP for sandboxed active content. It alone receives `unsafe-inline` and
 * `unsafe-eval`; the app renderer and ordinary embedded documents retain their
 * stricter policies.
 */
export function createActiveUntrustedContentSecurityPolicy(): string {
	const loopback = "http://127.0.0.1:*";
	return [
		"default-src 'none'",
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
		"style-src 'self' 'unsafe-inline'",
		`img-src 'self' data: blob: ${loopback}`,
		"font-src 'self' data: blob:",
		`media-src 'self' data: blob: ${loopback}`,
		`connect-src 'self' ${loopback}`,
		"worker-src 'self' blob:",
		"frame-src 'self' data: blob:",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		// Deliberately omit frame-ancestors here. Chromium rejects self-framing
		// custom-scheme documents once the iframe's no-allow-same-origin sandbox
		// gives it an opaque origin. The sandbox and the embedding application's
		// parent-window validation are the boundary for this code-only document.
	].join("; ");
}

/** Exact host match, so a near-miss cannot borrow an embedded host's policy. */
export function findEmbeddedHost(
	hosts: readonly EmbeddedWebHost[],
	host: string,
): EmbeddedWebHost | undefined {
	return hosts.find((candidate) => candidate.host === host);
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
 * navigation.
 *
 * The primary signal is the presence of a query string: `embed.js` calls
 * `fetch(widgetUrl)` **without** query parameters, then falls back to
 * `iframe.src = widgetUrl?tabId=...&hostOrigin=...` (see the upstream
 * `@mcp-b/webmcp-local-relay` package's `embed.js`, function `R`). Chromium
 * doesn't always populate `Sec-Fetch-*` or a full `Accept` header for requests
 * under our custom scheme, so header-only detection previously misidentified
 * iframe navigations as probes and returned 404 to them — leaving the widget
 * unloaded and Kilo showing zero WebMCP tools.
 *
 * Header signals are still consulted as a fallback for the rare case where
 * some future embed.js also passes query params on its probe.
 *
 * Returning 404 to the probe makes `embed.js` use its direct same-origin
 * iframe path instead of a blob iframe.
 */
function isRelayWidgetProbe(request: Request, requestUrl: URL): boolean {
	// Iframe navigations from embed.js always carry query params
	// (tabId, hostOrigin, ...). The fetch() probe carries none.
	if (requestUrl.search) return false;
	const destination = request.headers.get("Sec-Fetch-Dest");
	if (destination) return destination === "empty";
	const accept = request.headers.get("Accept") ?? "";
	return !accept.includes("text/html");
}

/**
 * Builds the policy once the response's inline script hashes are known. Which
 * of the two policies applies is a property of the requested host, so the
 * caller decides and this only supplies the hashes it extracted.
 */
type ContentSecurityPolicyBuilder = (inlineScriptHashes: readonly string[]) => string;

async function withSecurityHeaders(
	response: Response,
	buildPolicy: ContentSecurityPolicyBuilder,
): Promise<Response> {
	const headers = new Headers(response.headers);
	let body: BodyInit | null = response.body;
	let inlineScriptHashes: string[] = [];
	if (headers.get("Content-Type")?.toLowerCase().includes("text/html")) {
		const bytes = await response.arrayBuffer();
		body = bytes;
		inlineScriptHashes = getInlineScriptHashes(new TextDecoder().decode(bytes));
	}
	headers.set("Content-Security-Policy", buildPolicy(inlineScriptHashes));
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function contentTypeFor(filePath: string): string {
	return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Routes are consulted before the filesystem so a same-origin JSON endpoint
 * cannot be shadowed by a file the bundle happens to ship at that path.
 */
async function serveEmbeddedHost(embedded: EmbeddedWebHost, requestUrl: URL): Promise<Response> {
	const route = embedded.routes?.[requestUrl.pathname];
	if (route) {
		return Response.json(await route({ origin: `${requestUrl.protocol}//${requestUrl.host}` }));
	}

	// No bundle in this build — an expected state, not an error.
	if (!embedded.root) return new Response(null, { status: 404 });

	const filePath = await resolveRendererPath(embedded.root, requestUrl.pathname);
	if (!filePath) return new Response(null, { status: 404 });
	const body = Uint8Array.from(await readFile(filePath));
	return new Response(body, { headers: { "Content-Type": contentTypeFor(filePath) } });
}

export class ElectronProtocol {
	#registeredScheme: string | undefined;

	register(input: {
		readonly isDevelopment: boolean;
		readonly rendererRoot: string;
		readonly developmentOrigin?: string;
		/**
		 * Evaluated per request, not read once here: `protocol.register` runs before
		 * `bootFeatures` in `Application.start`, so a snapshotted array would stay
		 * empty for the process's whole lifetime.
		 */
		readonly embeddedHosts?: () => readonly EmbeddedWebHost[];
	}): void {
		const scheme = getDesktopScheme(input.isDevelopment);
		if (this.#registeredScheme === scheme) return;

		const appOrigin = getDesktopOrigin(input.isDevelopment);
		const appPolicyFor = (embeddedHosts: readonly EmbeddedWebHost[]) => {
			const frameOrigins = embeddedHosts.map((embedded) =>
				getDesktopOrigin(input.isDevelopment, embedded.host),
			);
			return (inlineScriptHashes: readonly string[]) =>
				createContentSecurityPolicy(input.developmentOrigin, inlineScriptHashes, frameOrigins);
		};

		protocol.handle(scheme, async (request) => {
			const requestUrl = new URL(request.url);
			const embeddedHosts = input.embeddedHosts?.() ?? [];

			if (requestUrl.host !== DESKTOP_HOST) {
				const embedded = findEmbeddedHost(embeddedHosts, requestUrl.host);
				if (!embedded) {
					return withSecurityHeaders(
						new Response(null, { status: 404 }),
						appPolicyFor(embeddedHosts),
					);
				}
				const embeddedPolicy = (inlineScriptHashes: readonly string[]) =>
					createEmbeddedContentSecurityPolicy(appOrigin, inlineScriptHashes);
				const activeUntrustedContentPolicy = () => createActiveUntrustedContentSecurityPolicy();
				return withSecurityHeaders(
					await serveEmbeddedHost(embedded, requestUrl),
					embedded.securityProfiles?.[requestUrl.pathname] ===
						ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE
						? activeUntrustedContentPolicy
						: embeddedPolicy,
				);
			}

			// Force the relay widget onto its direct same-origin iframe path (see
			// WEBMCP_WIDGET_PATH) by failing the `embed.js` `fetch()` probe.
			if (requestUrl.pathname === WEBMCP_WIDGET_PATH && isRelayWidgetProbe(request, requestUrl)) {
				return withSecurityHeaders(
					new Response(null, { status: 404 }),
					appPolicyFor(embeddedHosts),
				);
			}

			// Deliberately scoped to the app host: an embedded host's assets are not
			// served by the web dev server and would 404 if proxied there.
			if (input.isDevelopment && input.developmentOrigin) {
				const targetUrl = new URL(
					`${requestUrl.pathname}${requestUrl.search}`,
					input.developmentOrigin,
				);
				const response = await net.fetch(targetUrl.toString(), {
					method: request.method,
				});
				return withSecurityHeaders(response, appPolicyFor(embeddedHosts));
			}

			const filePath = await resolveRendererPath(input.rendererRoot, requestUrl.pathname);
			if (!filePath) {
				return withSecurityHeaders(
					new Response(null, { status: 404 }),
					appPolicyFor(embeddedHosts),
				);
			}
			const body = Uint8Array.from(await readFile(filePath));
			return withSecurityHeaders(
				new Response(body, { headers: { "Content-Type": contentTypeFor(filePath) } }),
				appPolicyFor(embeddedHosts),
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
