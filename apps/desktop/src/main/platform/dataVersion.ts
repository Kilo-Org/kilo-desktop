import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Keeps an older build from writing to data a newer build changed in a way it
 * can't read. Preview and Stable share one data folder, and an older build can
 * be installed over a newer one by hand, so the folder records the highest
 * data version written to it (`data-version.json`).
 *
 * The data version only goes up for a breaking change to saved data (a field
 * renamed, repurposed or reformatted); additive changes leave it alone, so
 * most releases share one. A build that raises it adds a `DataMigration`,
 * which backs up the files it changes first.
 *
 * `checkDataFolder` only reads and runs before anything opens the folder; a
 * folder from a higher data version is refused (`refuseNewerData`).
 * `upgradeDataFolder` writes, so it runs after the single-instance lock.
 * Builds released before this guard can't check, so the first raise should
 * ship at least one Stable release after it.
 */

export const DATA_VERSION = 1;
export const DATA_VERSION_FILE = "data-version.json";
const DOWNLOADS_URL = "https://kilo.ai/install";

export interface DataMigration {
	/** The data version this migration brings the folder to. */
	readonly to: number;
	/** Paths relative to the data folder that it changes, backed up first. */
	readonly files: readonly string[];
	readonly migrate: (userData: string) => void;
}

export const DATA_MIGRATIONS: readonly DataMigration[] = [];

export type DataFolderCheck =
	| { readonly kind: "ready" }
	| { readonly kind: "newer"; readonly dataVersion: number; readonly writtenBy: string | null };

interface DataVersionRecord {
	readonly dataVersion: number;
	readonly writtenBy: string | null;
}

export function checkDataFolder(userData: string, buildVersion = DATA_VERSION): DataFolderCheck {
	const { dataVersion, writtenBy } = readRecord(userData);
	return dataVersion > buildVersion ? { kind: "newer", dataVersion, writtenBy } : { kind: "ready" };
}

export function upgradeDataFolder(
	userData: string,
	options: {
		readonly appVersion: string;
		readonly buildVersion?: number;
		readonly migrations?: readonly DataMigration[];
		readonly now?: () => Date;
	},
): void {
	const buildVersion = options.buildVersion ?? DATA_VERSION;
	const now = options.now ?? (() => new Date());
	const current = readRecord(userData);
	if (current.dataVersion > buildVersion) return;

	const pending = (options.migrations ?? DATA_MIGRATIONS)
		.filter(({ to }) => to > current.dataVersion && to <= buildVersion)
		.toSorted((a, b) => a.to - b.to);
	for (const migration of pending) {
		backUp(userData, migration, now());
		migration.migrate(userData);
		writeRecord(userData, { dataVersion: migration.to, writtenBy: options.appVersion });
	}

	const next = { dataVersion: buildVersion, writtenBy: options.appVersion };
	if (current.dataVersion === next.dataVersion && current.writtenBy === next.writtenBy) return;
	try {
		writeRecord(userData, next);
	} catch {
		// Each migration recorded its own step, so this only names the latest
		// writer; a folder that can't take it still opens and retries next launch.
	}
}

export async function refuseNewerData(
	check: Extract<DataFolderCheck, { kind: "newer" }>,
	ui: {
		readonly whenReady: () => Promise<void>;
		readonly showMessageBox: (options: Electron.MessageBoxOptions) => Promise<{ response: number }>;
		readonly openExternal: (url: string) => Promise<boolean>;
		readonly quit: () => void;
	},
): Promise<void> {
	await ui.whenReady();
	const newer = check.writtenBy
		? `a newer version of Kilo (${check.writtenBy})`
		: "a newer version of Kilo";
	const { response } = await ui.showMessageBox({
		type: "warning",
		message: "Kilo can't open your data",
		detail: `Your data was last used by ${newer}. Update Kilo to open it; this version could damage data it doesn't understand.`,
		buttons: ["Download latest", "Quit"],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});
	if (response === 0) await ui.openExternal(DOWNLOADS_URL);
	ui.quit();
}

/** A missing or unreadable record counts as the first data version. */
function readRecord(userData: string): DataVersionRecord {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(path.join(userData, DATA_VERSION_FILE), "utf8"),
		);
		if (parsed && typeof parsed === "object") {
			const { dataVersion, writtenBy } = parsed as Record<string, unknown>;
			if (Number.isInteger(dataVersion) && (dataVersion as number) >= 1) {
				return {
					dataVersion: dataVersion as number,
					writtenBy: typeof writtenBy === "string" ? writtenBy : null,
				};
			}
		}
	} catch {
		// Falls through to the first data version.
	}
	return { dataVersion: 1, writtenBy: null };
}

function writeRecord(userData: string, record: DataVersionRecord): void {
	const file = path.join(userData, DATA_VERSION_FILE);
	writeFileSync(`${file}.tmp`, `${JSON.stringify(record, null, "\t")}\n`);
	renameSync(`${file}.tmp`, file);
}

function backUp(userData: string, migration: DataMigration, at: Date): void {
	const stamp = at
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replaceAll(":", "-");
	const backup = path.join(userData, "backups", `data-version-${migration.to}-${stamp}`);
	for (const file of migration.files) {
		const source = path.join(userData, file);
		if (!existsSync(source)) continue;
		const target = path.join(backup, file);
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(source, target);
	}
}
