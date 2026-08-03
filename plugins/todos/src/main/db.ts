import fs from "node:fs";
import { createRequire } from "node:module";
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
 * Resolve the plugin's `drizzle/` migrations folder across every layout:
 *
 * - source (tests, tooling): `drizzle/` sits at the plugin package root
 *   (`plugins/todos/drizzle`, two levels up from this file).
 * - bundled (`pnpm dev`) and packaged app: the desktop main process is
 *   bundled away from the plugin source (e.g. `<app>/.vite/build/main.js`),
 *   so the relative path no longer points at the plugin. Resolve the plugin
 *   package by name instead — this works for the hoisted dev copy in the
 *   workspace `node_modules` and for the `pnpm deploy` copy shipped into the
 *   packaged app's `node_modules`.
 *
 * The first candidate that exists on disk wins; if none do, throw with the
 * searched paths rather than letting `migrate()` fail with an opaque
 * "Can't find meta/_journal.json".
 */
export function resolveTodosMigrationsFolder(directory: string = import.meta.dirname): string {
	const candidates = [
		path.resolve(directory, "../../drizzle"),
		resolvePackagedMigrationsFolder(),
	].filter((candidate): candidate is string => candidate !== undefined);

	const found = candidates.find((candidate) => fs.existsSync(candidate));
	if (found === undefined) {
		throw new Error(
			`todos: could not locate the drizzle migrations folder. Looked in:\n  ${candidates.join("\n  ")}`,
		);
	}
	return found;
}

/**
 * The `drizzle/` folder next to the installed plugin package, located via Node
 * module resolution (`plugin.json` is an exported subpath). Returns undefined
 * when the package cannot be resolved from here (e.g. the pure-source layout,
 * where the relative candidate already applies).
 */
function resolvePackagedMigrationsFolder(): string | undefined {
	try {
		const require = createRequire(import.meta.url);
		const manifestPath = require.resolve("@anaconda-agentic-desktop/plugin-todos/plugin.json");
		return path.resolve(path.dirname(manifestPath), "drizzle");
	} catch {
		return undefined;
	}
}
