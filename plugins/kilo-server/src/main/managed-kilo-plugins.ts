import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Desktop's own Kilo plugins live outside `KILO_CONFIG_DIR` and reach Kilo as
 * `file://` specs in `KILO_CONFIG_CONTENT`, the way the JetBrains extension
 * injects its config. Plugin files in a config directory's `plugin/` folder
 * make the CLI npm-install `@kilocode/plugin` (62 MB) there on first launch
 * and block instance bootstrap on it; inline config never does. Desktop's
 * plugins are dependency-free, so they never need that install.
 */
export function managedKiloPluginDirectory(runtimeDirectory: string): string {
	return path.join(runtimeDirectory, "kilo-plugins");
}

export async function listManagedKiloPluginFiles(directory: string): Promise<string[]> {
	let filenames: string[];
	try {
		filenames = await readdir(directory);
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}
	return filenames
		.filter((filename) => filename.endsWith(".js"))
		.sort()
		.map((filename) => path.join(directory, filename));
}

export function kiloPluginConfigContent(pluginFiles: readonly string[]): string | undefined {
	if (pluginFiles.length === 0) return undefined;
	return JSON.stringify({ plugin: pluginFiles.map((file) => pathToFileURL(file).href) });
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
