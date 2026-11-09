export const ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE = "active-untrusted-content";
/**
 * Agent-authored HTML pages shown inline in chat. Like active-untrusted
 * content it runs inline script in an opaque-origin sandbox, but it gets no
 * network or loopback access: scripts load only from a fixed CDN allowlist and
 * `connect-src` is `'none'`.
 */
export const HTML_RENDER_CONTENT_SECURITY_PROFILE = "html-render-content";

export type EmbeddedWebHostSecurityProfile =
	| typeof ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE
	| typeof HTML_RENDER_CONTENT_SECURITY_PROFILE;

/**
 * Public CDNs agent-authored chart and diagram pages may load libraries,
 * styles, and fonts from — the only origins such a page can reach.
 */
const HTML_RENDER_CDN_SOURCES = [
	"https://cdn.jsdelivr.net",
	"https://unpkg.com",
	"https://cdnjs.cloudflare.com",
	"https://cdn.plot.ly",
	"https://cdn.bokeh.org",
	"https://cdn.holoviz.org",
].join(" ");

/**
 * CSP for agent-authored HTML pages. The page is written by a model that may
 * have read prompt-injected content, so unlike the active-untrusted policy it
 * gets no loopback access (it must not reach local servers) and
 * `connect-src 'none'`; images are inline-only so they cannot act as beacons.
 * Inline and eval'd script run, but in chat only inside the opaque-origin
 * sandbox the page is framed with.
 *
 * Served as a header for the in-chat page and embedded as a `<meta>` in a
 * saved copy, so the page is held to the same rules wherever it is opened.
 * Only uses directives a `<meta>` policy honors.
 */
export function createHtmlRenderContentSecurityPolicy(): string {
	return contentOnlyPolicy("");
}

/**
 * CSP for a workspace file shown in the Browser tab (`kilo-file:`). The same
 * containment as an agent page — any HTML file in a workspace may have been
 * written by the agent — except that it may also load files next to it
 * (`'self'`: its stylesheets, scripts, images, and frames). Reading them as
 * data stays off (`connect-src 'none'`), so a page cannot gather other
 * workspace files.
 */
export function createBrowserLocalFileContentSecurityPolicy(): string {
	return contentOnlyPolicy("'self' ");
}

function contentOnlyPolicy(self: "" | "'self' "): string {
	return [
		"default-src 'none'",
		`script-src ${self}'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${HTML_RENDER_CDN_SOURCES}`,
		`style-src ${self}'unsafe-inline' ${HTML_RENDER_CDN_SOURCES}`,
		`img-src ${self}data: blob:`,
		`font-src ${self}data: ${HTML_RENDER_CDN_SOURCES}`,
		`media-src ${self}data: blob:`,
		"connect-src 'none'",
		"worker-src blob:",
		self ? "frame-src 'self'" : "frame-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		// frame-ancestors omitted for the same reason as the active-untrusted
		// policy (and a <meta> policy would ignore it).
	].join("; ");
}

/**
 * Chromium's permission for `navigator.clipboard.write*`. Write-only: reading
 * the clipboard stays denied for every embedded host.
 */
export const CLIPBOARD_WRITE_EMBEDDED_PERMISSION = "clipboard-sanitized-write";

/** Browser permissions an embedded host may opt into; everything else stays denied. */
export type EmbeddedWebHostPermission = typeof CLIPBOARD_WRITE_EMBEDDED_PERMISSION;

export interface EmbeddedWebHostRouteContext {
	/** Resolved protocol origin of the document making this same-origin request. */
	readonly origin: string;
}

/**
 * A third-party web bundle served from a distinct host on the desktop scheme.
 * The host owns serving and security-policy enforcement; plugins contribute
 * only their bundle root, same-origin data routes, and named security profiles.
 */
export interface EmbeddedWebHost {
	readonly host: string;
	/** Undefined means this build intentionally ships no bundle. */
	readonly root: string | undefined;
	readonly routes?: Readonly<
		Record<string, (context: EmbeddedWebHostRouteContext) => Promise<unknown>>
	>;
	/**
	 * Inline HTML documents served directly by the shell, keyed by absolute
	 * request pathname (e.g. `/widget-host.html`). Use this instead of `root`
	 * for a small static document that does not warrant a filesystem bundle —
	 * the shell owns serving and security-policy enforcement, so the matching
	 * `securityProfiles` entry (if any) still selects the CSP. Consulted before
	 * `root`, so a document cannot be shadowed by a bundled file at that path.
	 */
	readonly documents?: Readonly<Record<string, string>>;
	readonly securityProfiles?: Readonly<Record<string, EmbeddedWebHostSecurityProfile>>;
	/**
	 * Browser permissions granted to documents on this host's exact origin. The
	 * shell denies every permission by default; sandboxed frames without
	 * `allow-same-origin` have an opaque origin and never receive these.
	 */
	readonly permissions?: readonly EmbeddedWebHostPermission[];
}
