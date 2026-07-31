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
 * Resolve the plugin's migrations folder in both layouts:
 * - source (tests, tooling): `drizzle/` at the plugin package root
 *   (`plugins/todos/drizzle`, two levels up from this file)
 * - packaged app: the desktop main bundle lives at `<app>/.vite/build`, and
 *   `pnpm deploy` ships this workspace package into the app's node_modules —
 *   migrations resolve at `<app>/node_modules/<package>/drizzle`
 */
export function resolveTodosMigrationsFolder(directory: string = import.meta.dirname): string {
	const sourceLayout = path.resolve(directory, "../../drizzle");
	if (fs.existsSync(sourceLayout)) return sourceLayout;
	return path.resolve(
		directory,
		"../../node_modules/@anaconda-agentic-desktop/plugin-todos/drizzle",
	);
}
