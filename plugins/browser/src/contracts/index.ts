import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";
import { Files } from "@kilo-desktop/plugin-workspaces/contracts";

import { basename, localFilePath, localFileUrl } from "./urls";

export * from "./urls";

/**
 * kilo.browser's public surface: the Browser pane kind
 * (`kilo.browser/browser`), openers for web pages (`kilo.browser/url`
 * objects, their id the URL) and a workspace's HTML files, web links in the
 * agent's replies, the `open` agent tool, and `pages` — the web page each
 * Browser pane shows, driven in main.
 */
export const BROWSER_PLUGIN_ID = "kilo.browser";

export const BROWSER_PANE_KIND = "kilo.browser/browser";

/** A web page as an object to open: its id is the normalized http(s) URL. */
export const URL_OBJECT_TYPE = "kilo.browser/url";

/** kilo.workspaces' file objects (an absolute path); `.html` / `.htm` ones open here. */
export const FILE_OBJECT_TYPE = Files.id;

/** Pane metadata keys. */
export const BROWSER_PANE_METADATA = {
	/** The page shown last (origin's key, so handed-over panes reopen it). */
	url: "url",
	/** Set by `Panes.openObject` and kept on the shown page, so opening it again reuses the pane. */
	objectType: "objectType",
	objectId: "objectId",
} as const;

/** The pane's icon key while its page has no favicon (any non-image key shows the globe). */
export const DEFAULT_BROWSER_ICON_KEY = "globe";

export interface ObjectRef {
	readonly type: string;
	readonly id: string;
}

/** The object a page is: a workspace file for `kilo-file:` URLs, else the URL. */
export function objectRefOfUrl(url: string, windows: boolean): ObjectRef {
	const path = localFilePath(url, windows);
	return path ? { type: FILE_OBJECT_TYPE, id: path } : { type: URL_OBJECT_TYPE, id: url };
}

/** The page a Browser pane shows: its last page, else the object it was opened for; "" for none. */
export function paneUrl(metadata: Readonly<Record<string, string>>): string {
	const url = metadata[BROWSER_PANE_METADATA.url];
	if (url) return url;
	const objectId = metadata[BROWSER_PANE_METADATA.objectId];
	if (!objectId) return "";
	switch (metadata[BROWSER_PANE_METADATA.objectType]) {
		case URL_OBJECT_TYPE:
			return objectId;
		case FILE_OBJECT_TYPE:
			return localFileUrl(objectId);
		default:
			return "";
	}
}

/** A pane opened for an object is titled with its host or file name until its page has a title. */
export function titleOfObject(ref: ObjectRef): string | undefined {
	if (ref.type === FILE_OBJECT_TYPE) return basename(ref.id);
	if (ref.type !== URL_OBJECT_TYPE) return undefined;
	try {
		return new URL(ref.id).host || undefined;
	} catch {
		return undefined;
	}
}

/** Pages are keyed by their pane (pane ids are unique within a session). */
export function pageKey(sessionId: string, paneId: string): string {
	return `${sessionId}/${paneId}`;
}

export const pageCommandSchema = z.enum([
	"back",
	"forward",
	"reload",
	"hardReload",
	"zoomIn",
	"zoomOut",
	"resetZoom",
	"openDevTools",
]);
export type PageCommand = z.output<typeof pageCommandSchema>;

const paneTarget = z.object({
	sessionId: z.string().min(1).max(512),
	paneId: z.string().min(1).max(512),
});
const webContentsId = z.number().int().positive();

export const browserPageSchema = paneTarget.extend({
	webContentsId,
	url: z.string().max(32_768),
	title: z.string().max(512),
	/** A `data:` image, or "". */
	faviconUrl: z.string().max(100_000),
	loading: z.boolean(),
	canGoBack: z.boolean(),
	canGoForward: z.boolean(),
	zoomFactor: z.number().positive(),
	failure: z.object({ code: z.number().int(), description: z.string().max(512) }).optional(),
});
export type BrowserPage = z.output<typeof browserPageSchema>;

/**
 * The web page each Browser pane shows. The pane's window embeds the guest
 * and attaches it here; main verifies it and drives it (navigation, history,
 * zoom, devtools) and publishes its state. A closed pane closes its page.
 */
export const BrowserPages = defineDomain({
	id: "kilo.browser/pages",
	home: "main",
	state: z.object({ pages: z.record(z.string(), browserPageSchema) }),
	methods: {
		/** Readies the guests' session; the partition a pane's guest must use. */
		prepare: method(z.undefined(), z.object({ partition: z.string().min(1) })),
		/** Takes over the pane's guest, replacing the pane's earlier one. */
		attach: method(paneTarget.extend({ webContentsId }), browserPageSchema),
		/** Lets the guest go, unless the pane has attached another since. */
		detach: method(paneTarget.extend({ webContentsId }), z.undefined()),
		navigate: method(paneTarget.extend({ url: z.string().min(1).max(32_768) }), z.undefined()),
		command: method(paneTarget.extend({ command: pageCommandSchema }), z.undefined()),
	},
});

export const BROWSER_DEFINITIONS: PluginDefinitions = {
	domains: [BrowserPages],
};
