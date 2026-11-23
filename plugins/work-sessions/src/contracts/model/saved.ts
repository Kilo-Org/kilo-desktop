import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

/** The longest saved text kept; longer selections are refused. */
export const SAVED_TEXT_MAX = 10_000;
/** The largest anchor (a source's own JSON locating the passage). */
export const SAVED_ANCHOR_MAX = 16_384;

const objectRefSchema = z.object({ type: z.string().min(1), id: z.string().min(1) });

export const savedItemSchema = z.object({
	id: z.string(),
	/** The `kilo.work-sessions/saved-source` contribution that saved it, e.g. `kilo.chat/chat-text`. */
	source: z.string().min(1),
	workSessionId: z.string().min(1),
	/** What it was saved from (a chat, a terminal). */
	ref: objectRefSchema,
	/** The source's title when saved, shown when `ref` no longer resolves. */
	title: z.string(),
	/** The saved text; empty for a bookmark. */
	text: z.string().max(SAVED_TEXT_MAX),
	/** Opaque to kilo.work-sessions: the source finds the passage again from it. */
	anchor: z.string().max(SAVED_ANCHOR_MAX),
	createdAt: z.number(),
});
export type SavedItem = z.output<typeof savedItemSchema>;

export const addSavedItemSchema = savedItemSchema.omit({ id: true, createdAt: true });
export type AddSavedItemInput = z.input<typeof addSavedItemSchema>;

export const savedItemsStateSchema = z.object({
	/** Newest first. */
	items: z.array(savedItemSchema),
	/** Items ever added (not lowered by removals), for content-free telemetry. */
	addedTotal: z.number().int().min(0),
});
export type SavedItemsState = z.output<typeof savedItemsStateSchema>;

/**
 * Saved: chats people bookmarked and text they saved, from every work
 * session and workspace, in one collection. Sources (kilo.chat; later the
 * terminal) add items through their `saved-source` contribution and find
 * the passage again from the anchor they wrote. A work session's items go
 * when the work session is deleted.
 */
export const SavedItems = defineDomainObject({
	id: "kilo.work-sessions/saved-items",
	home: "main",
	description: "Bookmarked chats and saved text from every work session.",
	state: savedItemsStateSchema,
	lookup: (state, key) => state.items.find((item) => item.id === key),
	methods: {
		/**
		 * Adds an item; an exact duplicate (same source, object and anchor)
		 * answers the existing one with `created: false`, so callers don't offer
		 * Undo for (and so delete) what was already saved.
		 */
		add: method(addSavedItemSchema, z.object({ item: savedItemSchema, created: z.boolean() })),
		remove: method(z.object({ id: z.string() }), z.object({ removed: savedItemSchema.nullable() })),
		/** Puts a removed item back as it was (Undo), keeping its id and time. */
		restore: method(z.object({ item: savedItemSchema }), savedItemSchema),
	},
	events: {
		added: z.object({ item: savedItemSchema }),
		removed: z.object({ item: savedItemSchema }),
	},
});
