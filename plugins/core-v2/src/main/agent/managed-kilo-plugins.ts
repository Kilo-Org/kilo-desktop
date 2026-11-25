import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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

function isMissingFileError(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
