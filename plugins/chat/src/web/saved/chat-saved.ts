import type { PluginSdk } from "@kilo-desktop/kernel";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	SavedItems,
	SavedSource,
	WorkSessionsWindow,
	type SavedItem,
	type SavedRevealResult,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { ageBucket, countBucket, lengthBucket } from "@kilo-desktop/ui/lib/reading/buckets";
import type { TextQuote } from "@kilo-desktop/ui/lib/reading/text-anchor";

import { chatPaneObject } from "../../contracts";
import type { ChatReading } from "../reading/chat-reading";
import { RevealRequests } from "./reveal-requests";
import {
	CHAT_BOOKMARK_SOURCE,
	CHAT_OBJECT_TYPE,
	CHAT_TEXT_SOURCE,
	parseBookmarkAnchor,
	parseTextAnchor,
	type ChatBookmarkAnchor,
	type ChatTextAnchor,
} from "./saved-anchor";

const SHOW_SAVED_COMMAND = "kilo.work-sessions/show-saved";

export interface ChatRef {
	readonly workSessionId: string;
	readonly chatId: string;
}

export type SavedKind = "text" | "chat";
export type SavedSurface = "chat" | "focus";

/**
 * Saved for kilo.chat in one window: saving reply text and bookmarking chats
 * into kilo.work-sessions' Saved collection, removing and restoring them
 * (Undo), and going back to an item from the Saved page (the two
 * `saved-source` contributions): open the chat's agent pane in its work
 * session and let the transcript scroll to the passage. Telemetry here
 * carries no text, titles or ids.
 */
export class ChatSaved {
	readonly reveals = new RevealRequests();

	constructor(
		readonly sdk: PluginSdk,
		readonly reading: ChatReading,
	) {}

	items(): readonly SavedItem[] {
		return this.sdk.domainObjects.get(SavedItems)?.getState().items ?? [];
	}

	itemsOfChat(chatId: string): readonly SavedItem[] {
		return this.items().filter(
			(item) => item.ref.type === CHAT_OBJECT_TYPE && item.ref.id === chatId,
		);
	}

	#title(chatId: string): string {
		return this.sdk.domainObjects.get(Chats)?.getState().chats[chatId]?.title ?? "";
	}

	async saveText(
		chat: ChatRef,
		messageId: string,
		selector: TextQuote,
		surface: SavedSurface,
	): Promise<SavedItem | null> {
		const anchor: ChatTextAnchor = { v: 1, messageId, selector };
		return this.#add(
			chat,
			CHAT_TEXT_SOURCE,
			selector.exact,
			JSON.stringify(anchor),
			"text",
			surface,
		);
	}

	async bookmark(chat: ChatRef): Promise<SavedItem | null> {
		const existing = this.bookmarkOf(chat.chatId);
		if (existing) await this.remove(existing, "bookmark-button");
		const anchor: ChatBookmarkAnchor = { v: 1 };
		return this.#add(chat, CHAT_BOOKMARK_SOURCE, "", JSON.stringify(anchor), "chat", "chat");
	}

	bookmarkOf(chatId: string): SavedItem | undefined {
		return this.itemsOfChat(chatId).find((item) => item.source === CHAT_BOOKMARK_SOURCE);
	}

	async #add(
		chat: ChatRef,
		source: string,
		text: string,
		anchor: string,
		kind: SavedKind,
		surface: SavedSurface,
	): Promise<SavedItem | null> {
		const saved = this.sdk.domainObjects.get(SavedItems);
		if (!saved) return null;
		const before = saved.getState().addedTotal;
		try {
			const item = await saved.methods.add({
				source,
				workSessionId: chat.workSessionId,
				ref: chatPaneObject(chat.chatId),
				title: this.#title(chat.chatId),
				text,
				anchor,
			});
			this.reading.noteSaved();
			this.reading.track("saved-item-added", {
				kind,
				surface,
				origin: kind === "text" ? "selection-menu" : "bookmark-button",
				selectionLength: lengthBucket(text.length),
				countInChat: countBucket(this.itemsOfChat(chat.chatId).length),
				isFirstTime: before === 0,
				lifetimeCount: countBucket(before + 1),
			});
			return item;
		} catch {
			this.reading.track("saved-action-failed", { action: "add", kind });
			return null;
		}
	}

	async remove(
		item: SavedItem,
		via: "highlight-menu" | "bookmark-button" | "undo",
	): Promise<SavedItem | null> {
		const kind = kindOf(item);
		try {
			const result = await this.sdk.domainObjects.get(SavedItems)?.methods.remove({ id: item.id });
			this.reading.track("saved-item-removed", {
				kind,
				via,
				ageBucket: ageBucket(Date.now() - item.createdAt),
			});
			return result?.removed ?? null;
		} catch {
			this.reading.track("saved-action-failed", { action: "remove", kind });
			return null;
		}
	}

	async restore(item: SavedItem): Promise<void> {
		try {
			await this.sdk.domainObjects.get(SavedItems)?.methods.restore({ item });
		} catch {
			this.reading.track("saved-action-failed", { action: "restore", kind: kindOf(item) });
		}
	}

	/** Opens the Saved page (leaving Focus first), through the window's command runner. */
	async viewSaved(execute: (command: string, args: unknown) => Promise<unknown>): Promise<void> {
		await this.reading.focus.exit("other");
		await execute(SHOW_SAVED_COMMAND, { source: "toast-view" }).catch(() => undefined);
	}

	/**
	 * Back to a saved item: its chat's agent pane in its work session,
	 * scrolled to the saved passage, or to the latest message for a bookmark.
	 */
	async reveal(item: SavedItem): Promise<SavedRevealResult> {
		const text = item.source === CHAT_TEXT_SOURCE ? parseTextAnchor(item.anchor) : null;
		if (!text && !parseBookmarkAnchor(item.anchor)) return "unavailable";
		await this.reading.focus.exit("other");
		const window = this.sdk.domainObjects.get(WorkSessionsWindow);
		const panes = this.sdk.domainObjects.get(Panes);
		if (!window || !panes) return "unavailable";
		const pending = this.reveals.request(
			item.ref.id,
			text ? { messageId: text.messageId, anchor: item.anchor } : "latest",
		);
		try {
			await window.methods.openWorkSession({ workSessionId: item.workSessionId });
			await panes.methods.openObject({
				workSessionId: item.workSessionId,
				ref: chatPaneObject(item.ref.id),
			});
		} catch {
			return "unavailable";
		}
		return pending;
	}
}

export function kindOf(item: SavedItem): SavedKind {
	return item.source === CHAT_BOOKMARK_SOURCE ? "chat" : "text";
}

/** Contributes kilo.chat's two Saved sources. */
export function activateChatSaved(sdk: PluginSdk, reading: ChatReading): ChatSaved {
	const saved = new ChatSaved(sdk, reading);
	const reveal = { reveal: (item: SavedItem) => saved.reveal(item) };
	sdk.extensions.implement(SavedSource, "chat-text", reveal);
	sdk.extensions.implement(SavedSource, "chat-bookmark", reveal);
	return saved;
}
