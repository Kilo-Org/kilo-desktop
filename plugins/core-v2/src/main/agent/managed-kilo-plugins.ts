import type { Dirent } from "node:fs";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Desktop's own Kilo plugins live outside `KILO2_CONFIG_DIR` and reach Kilo v2
 * as absolute folder paths in the inline config's `plugins` (v2 loads a
 * configured local plugin as a folder whose `index.js` is its entry). Every
 * change to them restarts the server, so the list is read at each start.
 * Desktop's plugins are dependency-free bundles, so Kilo installs nothing.
 */
export function managedKiloPluginDirectory(runtimeDirectory: string): string {
	return path.join(runtimeDirectory, "kilo-plugins");
}

/** The plugin folders (each holding an `index.js`) in the managed directory, in a stable order. */
export async function listManagedKiloPluginDirectories(directory: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}
	const folders = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(directory, entry.name))
		.sort();
	const withEntry = await Promise.all(
		folders.map(async (folder) =>
			(await stat(path.join(folder, "index.js")).catch(() => undefined))?.isFile()
				? folder
				: undefined,
		),
	);
	return withEntry.filter((folder): folder is string => folder !== undefined);
}

const LEGACY_MANAGED_PLUGIN_MARKER = "// Kilo Desktop managed plugin: ";
const LEGACY_CALLER_CONTEXT_FILENAME = "anaconda-desktop-caller-context.js";

/**
 * Earlier builds wrote Desktop's plugins into `<config>/plugin/`. Left there,
 * they keep triggering the CLI's dependency install and load twice. Only files
 * Desktop provably wrote are removed: the marker-stamped `anaconda-*.ts`
 * bundles and the generated caller-context plugin, which carried no marker.
 * An entry that cannot be processed must not block the rest, or the same
 * entry would stop cleanup on every launch; failures are reported at the end.
 */
export async function removeLegacyKiloConfigPlugins(configDirectory: string): Promise<void> {
	const legacyDirectory = path.join(configDirectory, "plugin");
	let filenames: string[];
	try {
		filenames = await readdir(legacyDirectory);
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
	const failures: string[] = [];
	for (const filename of filenames) {
		try {
			await removeIfLegacyPlugin(path.join(legacyDirectory, filename));
		} catch (error) {
			if (isMissingFileError(error)) continue;
			failures.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (failures.length > 0) {
		throw new Error(`Could not remove ${failures.join("; ")}`);
	}
}

async function removeIfLegacyPlugin(filePath: string): Promise<void> {
	if (
		path.basename(filePath) === LEGACY_CALLER_CONTEXT_FILENAME ||
		(await isLegacyManagedBundle(filePath))
	) {
		await unlink(filePath);
	}
}

function isMissingFileError(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function isLegacyManagedBundle(filePath: string): Promise<boolean> {
	if (!/^anaconda-.+\.ts$/.test(path.basename(filePath))) return false;
	const contents = await readFile(filePath, "utf8");
	return contents.startsWith(LEGACY_MANAGED_PLUGIN_MARKER);
}
