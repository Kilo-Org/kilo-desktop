import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

import { HTML_RENDER_MAX_HTML_LENGTH } from "./html-pages";

/** The media viewer pane kind: a chat's diagrams, images and pages, one pane per chat. */
export const MEDIA_PANE_KIND = "kilo.chat/media";

/** Media viewer pane metadata: the id of the item shown, among the viewer's items. */
export const MEDIA_ITEM_METADATA_KEY = "mediaItemId";

/** A chat's media viewer pane id: opening another item from the chat reuses it. */
export const mediaPaneId = (chatId: string | null): string => `media:${chatId ?? "draft"}`;

/**
 * Where the viewer's items are kept, and its `kilo.chat/media-viewers` lookup
 * key: per pane, as panes are per work session (the pane's own
 * `kilo.work-sessions/panes` key).
 */
export const mediaViewerKey = (workSessionId: string, paneId: string): string =>
	`${workSessionId}/${paneId}`;

/** The most items a viewer holds; a longer transcript keeps those nearest the opened one. */
export const MEDIA_VIEWER_MAX_ITEMS = 20;

/**
 * The longest inline image a viewer takes, in characters of its data URL:
 * ~10 MiB of image, the largest the Files pane previews, so whatever it
 * opens the viewer opens too.
 */
export const MEDIA_IMAGE_MAX_LENGTH = 14 * 1024 * 1024;

/**
 * How much of the items around the opened one a viewer takes, in characters
 * (~6 MB of images). The opened item always comes along, up to its own limit;
 * the neighbours only fill what's left of this, so opening one image doesn't
 * read and copy a transcript's worth of them.
 */
export const MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH = 8 * 1024 * 1024;

/** Mermaid sources Pele renders at most (its `limit`). */
const MERMAID_MAX_LENGTH = 50_000;
const TEXT_MAX_LENGTH = 1_000;

/**
 * Only inline image data crosses windows: `blob:` URLs belong to the window
 * that made them and remote images are blocked by the app's CSP.
 */
const INLINE_IMAGE_SOURCE = /^data:image\/[a-z0-9.+-]+[;,]/iu;

export const mediaItemSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("image"),
		id: z.string().min(1).max(TEXT_MAX_LENGTH),
		src: z
			.string()
			.max(MEDIA_IMAGE_MAX_LENGTH)
			.regex(INLINE_IMAGE_SOURCE, "Only inline image data can be shown."),
		alt: z.string().max(TEXT_MAX_LENGTH).optional(),
		filename: z.string().max(TEXT_MAX_LENGTH).optional(),
	}),
	z.object({
		kind: z.literal("mermaid"),
		id: z.string().min(1).max(TEXT_MAX_LENGTH),
		code: z.string().min(1).max(MERMAID_MAX_LENGTH),
		label: z.string().min(1).max(TEXT_MAX_LENGTH),
	}),
	/** An `html_render` page, shown in its sandboxed frame. */
	z.object({
		kind: z.literal("page"),
		id: z.string().min(1).max(TEXT_MAX_LENGTH),
		title: z.string().min(1).max(TEXT_MAX_LENGTH),
		html: z.string().min(1).max(HTML_RENDER_MAX_HTML_LENGTH),
	}),
]);
export type MediaItem = z.output<typeof mediaItemSchema>;

export const isTransferableMediaItem = (item: MediaItem): boolean =>
	mediaItemSchema.safeParse(item).success;

/** How much of a viewer's budget an item takes: its largest field, in characters. */
export const mediaItemLength = (item: MediaItem): number => {
	switch (item.kind) {
		case "image":
			return item.src.length;
		case "mermaid":
			return item.code.length;
		case "page":
			return item.html.length;
	}
};

/** An item's name, for the viewer pane's tab. */
export function mediaItemTitle(
	item:
		| Pick<Extract<MediaItem, { kind: "image" }>, "kind" | "alt" | "filename">
		| Pick<Extract<MediaItem, { kind: "mermaid" }>, "kind" | "label">
		| Pick<Extract<MediaItem, { kind: "page" }>, "kind" | "title">,
): string {
	switch (item.kind) {
		case "image":
			return item.alt?.trim() || item.filename || "Image";
		case "mermaid":
			return item.label;
		case "page":
			return item.title;
	}
}

const viewerTarget = z.object({
	workSessionId: z.string().min(1),
	paneId: z.string().min(1),
});

/**
 * Whether items fit one viewer: everything but the largest within the
 * neighbours' budget. The opened item isn't named, but a window that keeps it
 * plus neighbours within budget always passes: dropping the largest item
 * leaves at most the neighbours.
 */
export function fitsOneViewer(items: readonly MediaItem[]): boolean {
	const lengths = items.map(mediaItemLength);
	const total = lengths.reduce((sum, length) => sum + length, 0);
	return total - Math.max(0, ...lengths) <= MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH;
}

const viewerItems = z
	.array(mediaItemSchema)
	.min(1)
	.max(MEDIA_VIEWER_MAX_ITEMS)
	.refine(fitsOneViewer, "Too much media for one viewer.");

/**
 * What each media viewer pane shows, by `mediaViewerKey`: in main so a
 * popped-out pane shows it too, but not saved — images can be large, and a
 * pane's metadata is written to disk on every change. The items themselves
 * stay out of the broadcast state, which only carries a revision per viewer:
 * a pane fetches its own viewer's items with `items` when the revision
 * changes, so opening one viewer never resends another's images to every
 * window. A pane in the window that showed the items takes them from that
 * window instead of fetching them back. The item shown is the pane's own
 * metadata (`MEDIA_ITEM_METADATA_KEY`). Main holds a bounded amount in all,
 * dropping the viewers shown longest ago; their panes say there's nothing to
 * show until an item is opened again. Viewer panes don't outlive the app:
 * main closes the ones restored at launch, whose items are gone. Only
 * kilo.chat calls it. Looked up by `mediaViewerKey`.
 */
export const mediaViewerSchema = z.object({ revision: z.number().int().nonnegative() });
export type MediaViewer = z.output<typeof mediaViewerSchema>;

export const MediaViewers = defineDomainObject({
	id: "kilo.chat/media-viewers",
	home: "main",
	description: "The diagrams and images each media viewer pane shows, kept until it closes.",
	state: z.object({
		/** By `mediaViewerKey`. */
		viewers: z.record(z.string(), mediaViewerSchema),
	}),
	lookup: (state, key) => state.viewers[key],
	methods: {
		/** Sets the items a viewer pane shows, before the pane is opened on one; returns their revision. */
		show: method(
			viewerTarget.extend({ items: viewerItems }),
			z.object({ revision: z.number().int().nonnegative() }),
		),
		/** The items a viewer pane shows; null when it has none (they're gone). */
		items: method(viewerTarget, z.array(mediaItemSchema).nullable()),
		/** Forgets the items of a viewer whose pane could not be opened; an open pane keeps them. */
		discard: method(viewerTarget, z.undefined()),
	},
});
