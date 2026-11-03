/**
 * Local files shown in a Browser pane (an HTML page saved to a workspace, a
 * project's own `index.html`). The guest only loads http(s), so the desktop
 * host serves workspace files to it under this scheme instead of `file://`,
 * re-authorizing every request (kilo.browser answers with kilo.workspaces).
 *
 * URL shape: `kilo-file://local/<absolute path, each segment URI-encoded>`.
 * The path lives in the URL so a restored pane reopens the same file.
 */
export const LOCAL_FILE_SCHEME = "kilo-file";
const LOCAL_FILE_ORIGIN = `${LOCAL_FILE_SCHEME}://local`;
const WINDOWS_DRIVE_PATH = /^\/[A-Za-z]:\//;
const LOOPBACK_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

export function localFileUrl(absolutePath: string): string {
	const slashed = absolutePath.replaceAll("\\", "/");
	const rooted = slashed.startsWith("/") ? slashed : `/${slashed}`;
	return `${LOCAL_FILE_ORIGIN}${rooted.split("/").map(encodeURIComponent).join("/")}`;
}

/** The absolute path a `kilo-file:` URL names; undefined for any other URL. */
export function localFilePath(url: string, windows: boolean): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (`${parsed.protocol}//${parsed.host}` !== LOCAL_FILE_ORIGIN) return undefined;
	let path: string;
	try {
		path = parsed.pathname.split("/").map(decodeURIComponent).join("/");
	} catch {
		return undefined;
	}
	if (path.includes("\0")) return undefined;
	return windows && WINDOWS_DRIVE_PATH.test(path) ? path.slice(1) : path;
}

/**
 * What the address bar accepts: http(s) URLs (a bare host gets http for
 * loopback, https otherwise) and workspace-file URLs, which the host
 * authorizes per request, so the URL itself grants nothing.
 */
export function normalizeBrowserUrl(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	if (!trimmed) throw new Error("Enter a URL.");
	const candidate = trimmed.includes("://")
		? trimmed
		: `${LOOPBACK_PATTERN.test(trimmed) ? "http" : "https"}://${trimmed}`;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		throw new Error("Enter a valid URL.");
	}
	if (parsed.protocol === `${LOCAL_FILE_SCHEME}:`) return parsed.href;
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Only HTTP and HTTPS URLs are supported.");
	}
	return parsed.href;
}

/** Like {@link normalizeBrowserUrl}, but only web pages (links, the agent's tool). */
export function normalizeWebUrl(rawUrl: string): string {
	const url = normalizeBrowserUrl(rawUrl);
	if (url.startsWith(`${LOCAL_FILE_SCHEME}:`)) {
		throw new Error("Only HTTP and HTTPS URLs are supported.");
	}
	return url;
}

export function isWebUrl(href: string | undefined): href is string {
	return href !== undefined && /^https?:\/\//iu.test(href.trim());
}

export function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}
