import { readOriginDatabase, type SqliteLoader } from "../origin-database";

export interface OriginSession {
	readonly id: string;
	readonly createdAt: number;
	readonly chatIds: readonly string[];
}

/**
 * Reads the work sessions origin kept in kilo-ui's SQLite database, read-only:
 * ids and creation times, with their chats oldest first. Returns [] when the
 * file is absent or unusable (not a database, corrupt, or without origin's
 * tables); throws when it can't be read now, better-sqlite3 not loading
 * included (the caller retries).
 */
export async function readOriginSessions(
	file: string,
	loadDriver?: SqliteLoader,
): Promise<OriginSession[]> {
	const sessions = await readOriginDatabase(
		file,
		(db) => {
			const rows = db.prepare("SELECT id, created_at FROM sessions ORDER BY created_at").all() as {
				id: string;
				created_at: number;
			}[];
			const links = db
				.prepare("SELECT kilo_session_id, session_id FROM session_chats ORDER BY created_at")
				.all() as { kilo_session_id: string; session_id: string }[];
			return rows.map((session) => ({
				id: session.id,
				createdAt: session.created_at,
				chatIds: links
					.filter((link) => link.session_id === session.id)
					.map((link) => link.kilo_session_id),
			}));
		},
		loadDriver,
	);
	return sessions ?? [];
}
