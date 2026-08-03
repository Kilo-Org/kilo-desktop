import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

/**
 * Feature-owned SQLite database. Todos persists ONLY under the shell-provided
 * `mainSdk.storageDir` — never in the shared shell database (Decision #20).
 * Migrations live inside the plugin package (`drizzle/`) so they travel with
 * the plugin; the caller passes their resolved absolute path (in production
 * from `mainSdk.resolvePluginAsset("drizzle")`) so this module stays free of
 * dev-vs-packaged layout knowledge.
 */
export function createTodosDatabase(dbPath: string, migrationsFolder: string) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

export type TodosDatabase = ReturnType<typeof createTodosDatabase>;
