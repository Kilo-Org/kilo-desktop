import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Work sessions. A session exists on its own; its chats are linked in `session_chats`. */
export const sessions = sqliteTable("sessions", {
	id: text("id").primaryKey(),
	createdAt: integer("created_at").notNull(),
});

/** Links each chat (a Kilo session) to the one work session it belongs to. */
export const sessionChats = sqliteTable(
	"session_chats",
	{
		kiloSessionId: text("kilo_session_id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("session_chats_session_idx").on(table.sessionId, table.createdAt)],
);
