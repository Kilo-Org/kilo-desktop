import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

const idSchema = z.string().trim().min(1).max(256);

/** How many chats one adoption call may link; the renderer batches larger sets. */
export const SESSIONS_ADOPT_MAX_CHATS = 500;

/**
 * A work session: the unit of work listed in the sidebar. It owns its panes
 * and layout and has zero or more chats, each backed by a Kilo session. Its id
 * is minted for the session and is never derived from a chat.
 */
export const sessionSchema = z.object({
	id: idSchema,
	/** Kilo session ids of the session's chats, oldest first. */
	chatIds: z.array(idSchema),
});
export type SessionRecord = z.infer<typeof sessionSchema>;

export const sessionsContract = defineContract({
	"sessions.list": defineMethod(z.undefined(), z.object({ sessions: z.array(sessionSchema) })),
	/**
	 * Links a chat to a session, creating the session if it is not saved yet (a
	 * draft is saved when its first chat is created). Moves the chat if it
	 * belonged to another session.
	 */
	"sessions.attachChat": defineMethod(
		z.object({ sessionId: idSchema, kiloSessionId: idSchema }),
		sessionSchema,
	),
	/**
	 * Gives each chat that belongs to no session a new session of its own: chats
	 * created before work sessions existed, or by another Kilo client. State saved
	 * under a chat's Kilo session id moves to its new session (see the renderer's
	 * adoption). Returns only the chats adopted by this call.
	 */
	"sessions.adoptChats": defineMethod(
		z.object({ kiloSessionIds: z.array(idSchema).max(SESSIONS_ADOPT_MAX_CHATS) }),
		z.object({ adopted: z.record(idSchema, idSchema) }),
	),
	"sessions.delete": defineMethod(
		z.object({ sessionId: idSchema }),
		z.object({ deleted: z.boolean() }),
	),
	/**
	 * Unlinks a deleted chat. Until the UI can create sessions without a chat,
	 * a session left with none is deleted with it.
	 */
	"sessions.detachChat": defineMethod(
		z.object({ kiloSessionId: idSchema }),
		z.object({ deletedSessionId: idSchema.nullable() }),
	),
});
export type SessionsService = InferContract<typeof sessionsContract>;

export const SESSIONS_CHANGED_EVENT = "sessions-changed";
