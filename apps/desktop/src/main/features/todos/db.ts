import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

/**
 * Feature-owned SQLite database. Todos persists ONLY under the shell-provided
 * `mainSdk.storageDir` — never in the shared shell database (Decision #20).
 * Migrations live inside the feature directory so they travel with the
 * feature when it becomes a plugin.
 */
export function createTodosDatabase(
	dbPath: string,
	migrationsFolder: string = resolveTodosMigrationsFolder(),
) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}

export type TodosDatabase = ReturnType<typeof createTodosDatabase>;

/**
 * Resolve the feature's migrations folder in both layouts:
 * - source (tests, tooling): `drizzle/` next to this file
 * - bundled main.js (`<package>/.vite/build`): migrations ship at
 *   `<package>/src/main/features/todos/drizzle` (see the forge.config.ts
 *   packaging allowlist)
 */
export function resolveTodosMigrationsFolder(directory: string = import.meta.dirname): string {
	const sourceLayout = path.join(directory, "drizzle");
	if (fs.existsSync(sourceLayout)) return sourceLayout;
	return path.resolve(directory, "../../src/main/features/todos/drizzle");
}
