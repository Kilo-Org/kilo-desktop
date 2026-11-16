import { createContext, useContext } from "react";

import type { LightboxItem } from "@kilo-desktop/ui/components/media-lightbox";

import {
	isTransferableMediaItem,
	MEDIA_IMAGE_MAX_LENGTH,
	MEDIA_VIEWER_MAX_ITEMS,
	MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH,
	mediaItemLength,
	type MediaItem,
} from "../../contracts";

/**
 * A transcript item for the viewer: an image, a diagram, or an `html_render`
 * page. An unsent attachment's `src` is a `blob:` URL that only its window can
 * read, so it carries the file to inline.
 */
export type ViewerItem =
	| (Extract<LightboxItem, { kind: "image" }> & { readonly file?: Blob })
	| Extract<LightboxItem, { kind: "mermaid" }>
	| Extract<MediaItem, { kind: "page" }>;

/**
 * Opens the transcript's media viewer pane on `itemId`, among `items`.
 * Resolves false when the pane can't show that item (it isn't inline image
 * data, or the pane couldn't be opened), so the caller can show it some other
 * way. Never rejects.
 */
export type OpenMediaPane = (items: readonly ViewerItem[], itemId: string) => Promise<boolean>;

export const OpenMediaPaneContext = createContext<OpenMediaPane | null>(null);

/** The media viewer pane opener; null outside a work session's transcript or without panes. */
export const useOpenMediaPane = (): OpenMediaPane | null => useContext(OpenMediaPaneContext);

function readAsDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
		reader.readAsDataURL(file);
	});
}

/** The item as main keeps it: inline image data, no window-local fields. */
export async function toMediaItem(item: ViewerItem): Promise<MediaItem> {
	if (item.kind === "mermaid") {
		return { kind: "mermaid", id: item.id, code: item.code, label: item.label };
	}
	if (item.kind === "page") {
		return { kind: "page", id: item.id, title: item.title, html: item.html };
	}
	const src =
		item.file && !item.src.startsWith("data:") ? await readAsDataUrl(item.file) : item.src;
	return {
		kind: "image",
		id: item.id,
		src,
		...(item.alt ? { alt: item.alt } : {}),
		...(item.filename ? { filename: item.filename } : {}),
	};
}

/**
 * `items[index]` and the items nearest it, taken alternately before and after
 * it while they fit `limit` items and the neighbours fit `budget` total
 * `length`. A side stops at its first item that doesn't fit; the other side
 * carries on. Empty when there's no item at `index`.
 */
function nearest<T>(
	items: readonly T[],
	index: number,
	length: (item: T) => number,
	limit: number,
	budget: number,
): T[] {
	if (items[index] === undefined) return [];
	let start = index;
	let end = index + 1;
	let total = 0;
	let canBefore = true;
	let canAfter = true;
	let before = true;
	while (end - start < limit && (canBefore || canAfter)) {
		const takeBefore = before ? canBefore : !canAfter;
		before = !before;
		const next = takeBefore ? start - 1 : end;
		const candidate = items[next];
		if (candidate === undefined || total + length(candidate) > budget) {
			if (takeBefore) canBefore = false;
			else canAfter = false;
			continue;
		}
		total += length(candidate);
		if (takeBefore) start = next;
		else end = next + 1;
	}
	return items.slice(start, end);
}

/**
 * The items a viewer can hold: the opened one, and those nearest it when
 * there are too many or too much; empty when the opened one can't be shown.
 */
export function viewerItemsAround(
	items: readonly MediaItem[],
	itemId: string,
	limit = MEDIA_VIEWER_MAX_ITEMS,
	budget = MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH,
): MediaItem[] {
	const shown = items.filter(isTransferableMediaItem);
	return nearest(
		shown,
		shown.findIndex((item) => item.id === itemId),
		mediaItemLength,
		limit,
		budget,
	);
}

/** A base64 data URL's length for `bytes` of content: an estimate before reading a file. */
const estimatedDataUrlLength = (bytes: number): number => Math.ceil(bytes / 3) * 4 + 64;

/** What a not-yet-converted item will cost the viewer's budget. */
function viewerItemLength(item: ViewerItem): number {
	if (item.kind === "mermaid") return item.code.length;
	if (item.kind === "page") return item.html.length;
	if (item.file && !item.src.startsWith("data:")) return estimatedDataUrlLength(item.file.size);
	return item.src.length;
}

/**
 * Whether the item can go to main: a diagram, a page, inline image data, or a
 * readable file, no larger than a viewer takes (judged before any file is read).
 */
const canTransfer = (item: ViewerItem): boolean =>
	item.kind !== "image" ||
	((item.src.startsWith("data:image/") || item.file !== undefined) &&
		viewerItemLength(item) <= MEDIA_IMAGE_MAX_LENGTH);

/**
 * The items for a viewer opened on `itemId`, as main keeps them: trimmed to
 * the viewer's limits first, so opening one image only reads the attachment
 * files kept around it, then converted. Files that can't be read are left out.
 * Empty when the opened item can't be shown.
 */
export async function prepareViewerItems(
	items: readonly ViewerItem[],
	itemId: string,
): Promise<MediaItem[]> {
	const candidates = items.filter(canTransfer);
	const kept = nearest(
		candidates,
		candidates.findIndex((item) => item.id === itemId),
		viewerItemLength,
		MEDIA_VIEWER_MAX_ITEMS,
		MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH,
	);
	const converted = await Promise.allSettled(kept.map(toMediaItem));
	const readable = converted.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	return viewerItemsAround(readable, itemId);
}
