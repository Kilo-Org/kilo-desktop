import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

export function createDatabase(dbPath: string, migrationsFolder: string) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

/** Migrations live at `<package>/drizzle`; main is built to `<package>/.vite/build`. */
export function resolveMigrationsFolder(mainDirectory: string = import.meta.dirname): string {
	return path.join(mainDirectory, "../../drizzle");
}

export type AppDatabase = ReturnType<typeof createDatabase>;
