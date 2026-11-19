import type { TextQuote } from "@kilo-desktop/ui/lib/reading/text-anchor";

/** Saved text from a reply: the reply it is in and its quote. */
export interface ChatTextAnchor {
	readonly v: 1;
	readonly messageId: string;
	readonly selector: TextQuote;
}

/**
 * A bookmarked chat: the whole chat, opened at its latest message. Bookmarks
 * made before that may carry the reply they were set from; it is ignored.
 */
export interface ChatBookmarkAnchor {
	readonly v: 1;
}

export const CHAT_TEXT_SOURCE = "kilo.chat/chat-text";
export const CHAT_BOOKMARK_SOURCE = "kilo.chat/chat-bookmark";
export const CHAT_OBJECT_TYPE = "kilo.core/chat";

export function parseTextAnchor(anchor: string): ChatTextAnchor | null {
	try {
		const value = JSON.parse(anchor) as Partial<ChatTextAnchor>;
		return value.v === 1 && typeof value.messageId === "string" && value.selector?.exact
			? (value as ChatTextAnchor)
			: null;
	} catch {
		return null;
	}
}

export function parseBookmarkAnchor(anchor: string): ChatBookmarkAnchor | null {
	try {
		const value = JSON.parse(anchor) as Partial<ChatBookmarkAnchor> | null;
		return value?.v === 1 ? { v: 1 } : null;
	} catch {
		return null;
	}
}

/** The reply text parts of a message element: what a quote is taken from and found in. */
export function replySurfaces(message: Element): HTMLElement[] {
	return [...message.querySelectorAll<HTMLElement>('[data-reading-surface="reply"]')];
}
