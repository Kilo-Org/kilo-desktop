/**
 * Local files shown in the Browser tab (an HTML page saved to a workspace, a
 * project's own `index.html`). The browser guest only loads http(s), so the
 * host serves workspace files to it under this scheme instead of `file://`:
 * every request is re-authorized against the workspace registry and carries
 * {@link createBrowserLocalFileContentSecurityPolicy}.
 *
 * URL shape: `kilo-file://local/<absolute path, each segment URI-encoded>`.
 * kilo.browser builds these URLs (`localFileUrl`); the host only decodes them.
 * The path lives in the URL (not a session token) so a restored Browser tab
 * reopens the same file after a restart.
 */
export const BROWSER_LOCAL_FILE_SCHEME = "kilo-file";
const BROWSER_LOCAL_FILE_HOST = "local";
const BROWSER_LOCAL_FILE_ORIGIN = `${BROWSER_LOCAL_FILE_SCHEME}://${BROWSER_LOCAL_FILE_HOST}`;
const WINDOWS_DRIVE_PATH = /^\/[A-Za-z]:\//;

/**
 * The absolute path a `kilo-file:` URL names, or `undefined` for any other
 * URL. On Windows the leading slash before a drive letter is dropped.
 */
export function browserLocalFilePath(url: string, windows: boolean): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (`${parsed.protocol}//${parsed.host}` !== BROWSER_LOCAL_FILE_ORIGIN) return undefined;
	let path: string;
	try {
		path = parsed.pathname.split("/").map(decodeURIComponent).join("/");
	} catch {
		return undefined;
	}
	if (path.includes("\0")) return undefined;
	return windows && WINDOWS_DRIVE_PATH.test(path) ? path.slice(1) : path;
}

export function isBrowserLocalFileUrl(url: string): boolean {
	return url.startsWith(`${BROWSER_LOCAL_FILE_SCHEME}:`);
}
