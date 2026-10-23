import { asc, eq, inArray } from "drizzle-orm";

import type { SessionRecord } from "../../contracts/sessions/schemas.js";
import { mintSessionId } from "../../contracts/sessions/session-id.js";
import type { WorkspacesDatabase } from "../workspaces/db.js";
import { sessionChats, sessions } from "./schema.js";

/**
 * Owns the persisted work sessions and which chats (Kilo sessions) belong to
 * each. A session exists on its own and has zero or more chats; a chat belongs
 * to exactly one session (`session_chats` is keyed by the chat). Session ids
 * are minted, never derived from a chat. Until the UI can create a session
 * without a chat, a draft is only saved when its first chat is attached, and
 * a session whose last chat is deleted is deleted with it.
 */
export class SessionService {
	constructor(
		private readonly db: WorkspacesDatabase,
		private readonly createId: () => string = mintSessionId,
		private readonly now: () => number = Date.now,
	) {}

	list(): SessionRecord[] {
		const rows = this.db.select().from(sessions).orderBy(asc(sessions.createdAt)).all();
		const links = this.db.select().from(sessionChats).orderBy(asc(sessionChats.createdAt)).all();
		const chatIds = new Map<string, string[]>(rows.map((row) => [row.id, []]));
		for (const link of links) chatIds.get(link.sessionId)?.push(link.kiloSessionId);
		return rows.map((row) => ({ id: row.id, chatIds: chatIds.get(row.id) ?? [] }));
	}

	attachChat(sessionId: string, kiloSessionId: string): SessionRecord {
		this.db.transaction((tx) => {
			const createdAt = this.now();
			tx.insert(sessions).values({ id: sessionId, createdAt }).onConflictDoNothing().run();
			tx.insert(sessionChats)
				.values({ kiloSessionId, sessionId, createdAt })
				.onConflictDoUpdate({ target: sessionChats.kiloSessionId, set: { sessionId, createdAt } })
				.run();
		});
		return this.getRequired(sessionId);
	}

	adoptChats(kiloSessionIds: readonly string[]): Record<string, string> {
		const unique = [...new Set(kiloSessionIds)];
		if (unique.length === 0) return {};
		return this.db.transaction((tx) => {
			const linked = new Set(
				tx
					.select({ kiloSessionId: sessionChats.kiloSessionId })
					.from(sessionChats)
					.where(inArray(sessionChats.kiloSessionId, unique))
					.all()
					.map((row) => row.kiloSessionId),
			);
			const adopted: Record<string, string> = {};
			for (const kiloSessionId of unique) {
				if (linked.has(kiloSessionId)) continue;
				const sessionId = this.createId();
				const createdAt = this.now();
				tx.insert(sessions).values({ id: sessionId, createdAt }).run();
				tx.insert(sessionChats).values({ kiloSessionId, sessionId, createdAt }).run();
				adopted[kiloSessionId] = sessionId;
			}
			return adopted;
		});
	}

	delete(sessionId: string): boolean {
		return this.db.delete(sessions).where(eq(sessions.id, sessionId)).run().changes > 0;
	}

	/** Unlinks a chat; reports whether it was linked and which session it left empty and deleted. */
	detachChat(kiloSessionId: string): { unlinked: boolean; deletedSessionId: string | null } {
		return this.db.transaction((tx) => {
			const link = tx
				.select()
				.from(sessionChats)
				.where(eq(sessionChats.kiloSessionId, kiloSessionId))
				.get();
			if (!link) return { unlinked: false, deletedSessionId: null };
			tx.delete(sessionChats).where(eq(sessionChats.kiloSessionId, kiloSessionId)).run();
			const remaining = tx
				.select({ kiloSessionId: sessionChats.kiloSessionId })
				.from(sessionChats)
				.where(eq(sessionChats.sessionId, link.sessionId))
				.get();
			if (remaining) return { unlinked: true, deletedSessionId: null };
			tx.delete(sessions).where(eq(sessions.id, link.sessionId)).run();
			return { unlinked: true, deletedSessionId: link.sessionId };
		});
	}

	private getRequired(sessionId: string): SessionRecord {
		const chatIds = this.db
			.select({ kiloSessionId: sessionChats.kiloSessionId })
			.from(sessionChats)
			.where(eq(sessionChats.sessionId, sessionId))
			.orderBy(asc(sessionChats.createdAt))
			.all()
			.map((row) => row.kiloSessionId);
		return { id: sessionId, chatIds };
	}
}
