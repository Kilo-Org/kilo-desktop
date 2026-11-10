import type BetterSqlite3 from "better-sqlite3";

import type { KernelLogger } from "@kilo-desktop/kernel";

type DatabaseConstructor = typeof BetterSqlite3;

/** Loads the module itself (injected in tests to stand for a build without it). */
export type SqliteLoader = () => Promise<DatabaseConstructor>;

const loadBetterSqlite: SqliteLoader = async () => (await import("better-sqlite3")).default;

/**
 * better-sqlite3, loaded lazily: it is only needed for the one-time imports
 * of origin's kilo-ui database, so a build without it (or with a native
 * binary that doesn't match) must not break activation. Null when it can't
 * load; the import then has nothing to read.
 */
export async function loadSqlite(
	logger: KernelLogger,
	load: SqliteLoader = loadBetterSqlite,
): Promise<DatabaseConstructor | null> {
	try {
		return await load();
	} catch (error) {
		logger.warn(
			`Origin's database can't be read without better-sqlite3; nothing is imported from it: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}
