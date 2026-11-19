import { existsSync } from "node:fs";

import type BetterSqlite3 from "better-sqlite3";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { Notifications } from "@kilo-desktop/plugin-shell/contracts";

type DatabaseConstructor = typeof BetterSqlite3;

/** Loads the module itself (injected in tests to stand for a build without it). */
export type SqliteLoader = () => Promise<DatabaseConstructor>;

const loadBetterSqlite: SqliteLoader = async () => (await import("better-sqlite3")).default;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
 * Reads origin's kilo-ui database, read-only, with `read`. Null when there
 * is nothing to import: the file is absent or unusable. better-sqlite3 is
 * loaded lazily, only for these one-time imports, so a build without it (or
 * with a native binary that doesn't match) can still activate; failing to
 * load it throws like any other read failure, so the import is retried next
 * launch rather than counted as done with nothing in it.
 */
export async function readOriginDatabase<T>(
	file: string,
	read: (db: BetterSqlite3.Database) => T,
	load: SqliteLoader = loadBetterSqlite,
): Promise<T | null> {
	if (!existsSync(file)) return null;
	let Database: DatabaseConstructor;
	try {
		Database = await load();
	} catch (error) {
		throw new Error(`better-sqlite3 can't be loaded: ${errorText(error)}`, { cause: error });
	}
	let db: BetterSqlite3.Database;
	try {
		db = new Database(file, { readonly: true, fileMustExist: true });
	} catch (error) {
		if (isUnusableDatabase(error)) return null;
		throw error;
	}
	try {
		return read(db);
	} catch (error) {
		if (isUnusableDatabase(error)) return null;
		throw error;
	} finally {
		db.close();
	}
}

/** The persisted markers of one area's import from origin. */
export interface OriginImportMarkers {
	readonly importedFromOrigin: boolean;
	readonly originImportVerified?: boolean | undefined;
}

/**
 * What an area's import from origin does this launch. `recover` re-reads
 * origin for an install an earlier release marked imported even when
 * better-sqlite3 couldn't load (DESK-3435): those imports can't be told
 * apart from real ones, so it only brings origin's records over when none
 * of them are here (see `recoverable`).
 */
export function originImportMode(markers: OriginImportMarkers): "import" | "recover" | "done" {
	if (!markers.importedFromOrigin) return "import";
	return markers.originImportVerified ? "done" : "recover";
}

/**
 * Whether a recovering import brings origin's records over: none of them
 * are here, so the earlier import evidently read nothing. One that did
 * import left some behind unless the person removed every one of them.
 */
export function recoverable(originIds: readonly string[], presentIds: Iterable<string>): boolean {
	const present = new Set(presentIds);
	return originIds.length > 0 && originIds.every((id) => !present.has(id));
}

const IMPORT_FAILED_NOTICE = "origin-import-failed";

/**
 * Logs an import from origin that failed and will be retried next launch,
 * and tells the person with a notice (one for every area, when kilo.shell
 * is here): their old workspaces or sessions are missing for now.
 */
export function reportOriginImportFailure(
	sdk: PluginSdk,
	what: string,
	file: string,
	error: unknown,
): void {
	sdk.logger.warn(
		`Could not import ${what} from ${file}; will try again next launch: ${errorText(error)}`,
	);
	let posted = false;
	const stop = sdk.domainObjects.track(Notifications, {
		added: (notifications) => {
			if (posted) return;
			posted = true;
			void notifications.methods
				.post({
					id: IMPORT_FAILED_NOTICE,
					level: "warning",
					title: "Some workspaces or sessions from the previous version weren't brought over",
					description:
						"They are still on this computer; Kilo will try again the next time it starts.",
				})
				.catch(() => undefined);
		},
		removed: () => {},
	});
	// kilo.shell may only arrive later; the notice is posted once, when it does.
	if (posted) stop();
	else sdk.onDispose(stop);
}
