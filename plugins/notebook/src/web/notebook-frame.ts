import { NOTEBOOK_HOST, notebookFileOf, type NotebookConnectionArgs } from "../contracts/index.js";

/**
 * Matches both the production and `-dev` desktop schemes. Getting it wrong
 * falls back to browser mode rather than framing a wrong origin.
 */
export const DESKTOP_SCHEME_PREFIX = "kilo-desktop";

/**
 * The window cannot tell whether the app is packaged, so it cannot derive the
 * scheme — but its own origin already carries the right one, and only the
 * host differs. Undefined off the desktop scheme (browser mode), where the
 * notebook host does not exist.
 */
export function notebookOriginFrom(appOrigin: string): string | undefined {
	let url: URL;
	try {
		url = new URL(appOrigin);
	} catch {
		return undefined;
	}
	if (!url.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) return undefined;
	// Assembled rather than read off `url.origin`, which is "null" for a scheme
	// the URL parser does not know is special.
	return `${url.protocol}//${NOTEBOOK_HOST}`;
}

export function nteractSrcFor(
	notebookId: string,
	location: Pick<Location, "protocol" | "host">,
	developmentOrigin?: string,
): string | undefined {
	const appOrigin = `${location.protocol}//${location.host}`;
	const origin = notebookOriginFrom(appOrigin) ?? developmentOrigin;
	if (!origin) return undefined;
	const url = new URL(origin);
	url.searchParams.set("notebook_id", notebookId);
	if (url.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) {
		url.searchParams.set("nteract-host", "electron");
		url.searchParams.set("nteract-parent-origin", appOrigin);
	}
	return url.toString();
}

/** Read at render time, so browser mode can frame nteract's dev server (`VITE_NTERACT_ORIGIN`). */
export function nteractSrc(notebookId: string): string | undefined {
	return nteractSrcFor(
		notebookId,
		window.location,
		import.meta.env["VITE_NTERACT_ORIGIN"] as string | undefined,
	);
}

/** What a pane's frame opens the `host` port with. */
export function notebookHostConnectionArgs(input: {
	readonly notebookId: string;
	readonly sessionId: string;
	readonly title: string;
	readonly directory: string | null;
	readonly metadata: Readonly<Record<string, string>>;
}): NotebookConnectionArgs {
	const notebookPath = notebookFileOf({ metadata: input.metadata });
	return {
		notebookId: input.notebookId,
		sessionId: input.sessionId,
		title: input.title,
		...(notebookPath ? { notebookPath } : {}),
		...(input.directory ? { workingDirectory: input.directory } : {}),
	};
}
