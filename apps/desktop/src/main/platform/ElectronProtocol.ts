import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { net, protocol } from "electron";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	HTML_RENDER_CONTENT_SECURITY_PROFILE,
	BROWSER_LOCAL_FILE_SCHEME,
	createHtmlRenderContentSecurityPolicy,
	type EmbeddedWebHost,
	type EmbeddedWebHostSecurityProfile,
} from "@kilo-desktop/feature-sdk/main";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "kilo-desktop";
export const DESKTOP_DEVELOPMENT_SCHEME = "kilo-desktop-dev";
// Application policy: renderer features may connect to app-managed loopback servers on
// ephemeral ports. Remote HTTP, localhost aliases, and WebSocket origins remain disallowed.
const LOOPBACK_SERVER_CONNECT_SOURCE = "http://127.0.0.1:*";
const BOKEH_CDN_SOURCE = "https://cdn.bokeh.org";
const HOLOVIZ_CDN_SOURCE = "https://cdn.holoviz.org";

const MIME_TYPES: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".htm": "text/html; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".lottie": "application/zip",
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

/**
 * Plugin-declared protocol schemes (`mainSdk.protocol`) are manifest-declared
 * because `registerSchemesAsPrivileged` must run before app-ready — the loader
 * does not (and cannot) extend this list at runtime. `main.ts` passes the
 * schemes here for privileged registration, and `Application` passes the same
 * list to `ElectronProtocol.register` so `createContentSecurityPolicy` emits
 * matching `connect-src` entries.
 */
export function getDesktopOrigin(isDevelopment: boolean, host: string = DESKTOP_HOST): string {
	return `${getDesktopScheme(isDevelopment)}://${host}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
	return `${getDesktopOrigin(isDevelopment)}/#/`;
}

export function getDesktopRouteUrl(
	isDevelopment: boolean,
	route: string,
	search: Readonly<Record<string, string>>,
): string {
	const params = new URLSearchParams(search);
	return `${getDesktopOrigin(isDevelopment)}/#${route}${params.size > 0 ? `?${params}` : ""}`;
}

export function registerDesktopSchemes(pluginSchemes: readonly string[]): void {
	protocol.registerSchemesAsPrivileged([
		...[DESKTOP_PRODUCTION_SCHEME, DESKTOP_DEVELOPMENT_SCHEME, ...pluginSchemes].map((scheme) => ({
			scheme,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
			},
		})),
		// Workspace files in the Browser tab (handled on the browser partition
		// only). Standard so a page's relative links resolve and `'self'` names
		// its folder; no fetch/CORS privileges, matching its `connect-src 'none'`.
		{ scheme: BROWSER_LOCAL_FILE_SCHEME, privileges: { standard: true, stream: true } },
	]);
}

export function createContentSecurityPolicy(
	developmentOrigin?: string,
	inlineScriptHashes: readonly string[] = [],
	frameOrigins: readonly string[] = [],
	/** Plugin-declared protocol schemes (mainSdk.protocol), connectable. */
	pluginSchemes: readonly string[] = [],
): string {
	const developmentSources = developmentOrigin ? ` ${new URL(developmentOrigin).origin} ws:` : "";
	// Inline-script policy for the trusted app renderer (the origin that holds
	// the preload bridge). In development Vite injects and rewrites inline
	// scripts at runtime that a static hash allowlist cannot cover, so dev keeps
	// `'unsafe-inline'`. Production pins each shipped inline script by its
	// sha256 hash instead — never `'unsafe-inline'` — so an injected inline
	// script (XSS) cannot execute here. Both former consumers of `'unsafe-inline'`
	// on this origin were moved off `blob:` iframes that inherit this policy:
	// (1) MCP App widgets now render under the dedicated `mcp-app` embedded origin
	// with the active-untrusted profile, and (2) the former WebMCP relay widget
	// is gone (agent tools reach the main process over IPC). So no dynamic inline
	// script needs `'unsafe-inline'` on this origin in production. `'unsafe-inline'`
	// and hash/nonce sources are mutually exclusive in CSP, so exactly one is emitted.
	const inlineScriptSources = developmentOrigin
		? " 'unsafe-inline'"
		: inlineScriptHashes.map((hash) => ` 'sha256-${hash}'`).join("");
	return [
		"default-src 'self'",
		// `'wasm-unsafe-eval'` instantiates the bundled DotLottie WASM player
		// (welcome logo). It is not `'unsafe-eval'` and does not allow remote
		// script; the .wasm file is shipped with `@lottiefiles/dotlottie-web`.
		`script-src 'self'${inlineScriptSources} 'wasm-unsafe-eval'${developmentSources}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		// `connect-src`: `LOOPBACK_SERVER_CONNECT_SOURCE` reaches app-managed
		// loopback servers (e.g. the local Kilo server).
		`connect-src 'self' ${pluginSchemes.map((scheme) => `${scheme}:`).join(" ")} ${LOOPBACK_SERVER_CONNECT_SOURCE}${developmentSources}`,
		// `frame-src 'self' blob:`: `frameOrigins` names the sibling embedded hosts
		// (e.g. `mcp-app`, where MCP App widgets render under their own isolated
		// origin); `blob:` is retained only for the non-custom-scheme MCP App
		// fallback (`ElectronMcpAppRenderer` blob path, used only where there is
		// no preload bridge). `frame-ancestors 'self'`: no cross-origin embedders
		// exist under the custom scheme, so `'self'` blocks external framing.
		`frame-src 'self' blob:${frameOrigins.length > 0 ? ` ${frameOrigins.join(" ")}` : ""}`,
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
		`script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${BOKEH_CDN_SOURCE} ${HOLOVIZ_CDN_SOURCE}`,
		`style-src 'self' 'unsafe-inline' ${HOLOVIZ_CDN_SOURCE}`,
		`img-src 'self' data: blob: ${loopback}`,
		// panel-material-ui's stylesheet on the HoloViz CDN references its Roboto
		// and Material Icons fonts there.
		`font-src 'self' data: blob: ${HOLOVIZ_CDN_SOURCE}`,
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

function embeddedPolicyFor(
	profile: EmbeddedWebHostSecurityProfile | undefined,
	appOrigin: string,
): ContentSecurityPolicyBuilder {
	switch (profile) {
		case ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE:
			return () => createActiveUntrustedContentSecurityPolicy();
		case HTML_RENDER_CONTENT_SECURITY_PROFILE:
			return () => createHtmlRenderContentSecurityPolicy();
		default:
			return (inlineScriptHashes) =>
				createEmbeddedContentSecurityPolicy(appOrigin, inlineScriptHashes);
	}
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

export function contentTypeFor(filePath: string): string {
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

	// Inline documents are consulted before the filesystem so a static document
	// (e.g. the MCP App widget shell) cannot be shadowed by a bundled file, and
	// so a document-only host with no `root` still serves.
	const inlineDocument = embedded.documents?.[requestUrl.pathname];
	if (inlineDocument !== undefined) {
		return new Response(inlineDocument, {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
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
	// Plugin protocol schemes (mainSdk.protocol) and their handlers, keyed
	// by scheme, tracked so app shutdown (`unregisterAllFeatureSchemes`)
	// can unhandle exactly what features registered — a scheme stays bound
	// for the process lifetime, not the plugin's (feature teardown does not
	// release it).
	#featureSchemes = new Map<string, (request: Request) => Promise<Response> | Response>();

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
		/**
		 * Plugin-declared protocol schemes (mainSdk.protocol), so the app CSP
		 * keeps emitting matching `connect-src` entries. `Application` passes
		 * the same manifest-derived list `main.ts` registers pre-ready.
		 */
		readonly pluginSchemes?: readonly string[];
	}): void {
		const scheme = getDesktopScheme(input.isDevelopment);
		if (this.#registeredScheme === scheme) return;

		const appOrigin = getDesktopOrigin(input.isDevelopment);
		// The dev-server origin only applies to the development build. Gate it on
		// `isDevelopment` here so a packaged build can never widen the CSP or
		// re-enable `script-src 'unsafe-inline'` (EoP 7) just because
		// `KILO_WEB_DEV_SERVER_URL` happens to be present in its environment. The
		// production guarantee is thus structural, not env-dependent.
		const developmentOrigin = input.isDevelopment ? input.developmentOrigin : undefined;
		const appPolicyFor = (embeddedHosts: readonly EmbeddedWebHost[]) => {
			const frameOrigins = embeddedHosts.map((embedded) =>
				getDesktopOrigin(input.isDevelopment, embedded.host),
			);
			return (inlineScriptHashes: readonly string[]) =>
				createContentSecurityPolicy(
					developmentOrigin,
					inlineScriptHashes,
					frameOrigins,
					input.pluginSchemes ?? [],
				);
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
				return withSecurityHeaders(
					await serveEmbeddedHost(embedded, requestUrl),
					embeddedPolicyFor(embedded.securityProfiles?.[requestUrl.pathname], appOrigin),
				);
			}

			// Deliberately scoped to the app host: an embedded host's assets are not
			// served by the web dev server and would 404 if proxied there.
			// `developmentOrigin` is already gated on `isDevelopment` above.
			if (developmentOrigin) {
				const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, developmentOrigin);
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

	/**
	 * Bind a plugin's protocol scheme (`mainSdk.protocol`, manifest-declared)
	 * to its request handler. Legal only after app-ready — the privileged
	 * scheme list is registered pre-ready by `registerDesktopSchemes`. A
	 * repeated registration replaces the handler, mirroring Electron's own
	 * `protocol.handle` semantics.
	 */
	registerFeatureScheme(
		scheme: string,
		handler: (request: Request) => Promise<Response> | Response,
	): void {
		protocol.handle(scheme, handler);
		this.#featureSchemes.set(scheme, handler);
	}

	unregisterFeatureScheme(scheme: string): void {
		if (!this.#featureSchemes.delete(scheme)) return;
		protocol.unhandle(scheme);
	}

	unregisterAllFeatureSchemes(): void {
		for (const scheme of [...this.#featureSchemes.keys()]) {
			this.unregisterFeatureScheme(scheme);
		}
	}

	dispose(): void {
		this.unregisterAllFeatureSchemes();
		if (!this.#registeredScheme) return;
		protocol.unhandle(this.#registeredScheme);
		this.#registeredScheme = undefined;
	}
}
