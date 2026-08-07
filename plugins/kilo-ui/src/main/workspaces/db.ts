import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

export function createWorkspacesDatabase(dbPath: string, migrationsFolder: string) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("journal_mode = WAL");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

export type WorkspacesDatabase = ReturnType<typeof createWorkspacesDatabase>;
