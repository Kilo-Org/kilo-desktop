import { existsSync } from "node:fs";

import type BetterSqlite3 from "better-sqlite3";

export interface OriginSession {
	readonly id: string;
	readonly createdAt: number;
	readonly chatIds: readonly string[];
}

/** A file that isn't a database, is corrupt or lacks origin's tables: retrying can't help. */
function isUnusableDatabase(error: unknown): boolean {
	const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
	return (
		code === "SQLITE_NOTADB" ||
		(typeof code === "string" && code.startsWith("SQLITE_CORRUPT")) ||
		(typeof message === "string" && message.startsWith("no such table"))
	);
}

/**
 * Reads the work sessions origin kept in kilo-ui's SQLite database, read-only:
 * ids and creation times, with their chats oldest first. Returns [] when the
 * file is absent or unusable (not a database, corrupt, without origin's
 * tables); throws when it can't be read now. better-sqlite3 loads lazily so a
 * mismatched native build can't break activation.
 */
export async function readOriginSessions(file: string): Promise<OriginSession[]> {
	if (!existsSync(file)) return [];
	const { default: Database } = await import("better-sqlite3");
	try {
		return readSessions(new Database(file, { readonly: true, fileMustExist: true }));
	} catch (error) {
		if (isUnusableDatabase(error)) return [];
		throw error;
	}
}

function readSessions(db: BetterSqlite3.Database): OriginSession[] {
	try {
		const sessions = db
			.prepare("SELECT id, created_at FROM sessions ORDER BY created_at")
			.all() as {
			id: string;
			created_at: number;
		}[];
		const links = db
			.prepare("SELECT kilo_session_id, session_id FROM session_chats ORDER BY created_at")
			.all() as { kilo_session_id: string; session_id: string }[];
		return sessions.map((session) => ({
			id: session.id,
			createdAt: session.created_at,
			chatIds: links
				.filter((link) => link.session_id === session.id)
				.map((link) => link.kilo_session_id),
		}));
	} finally {
		db.close();
	}
}
