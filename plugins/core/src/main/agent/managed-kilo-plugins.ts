import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";

/**
 * Desktop's own Kilo server plugins live outside Desktop's Kilo config
 * directory and reach Kilo as paths in `KILO_CONFIG_CONTENT`'s `plugins`. Kilo
 * v2 loads a configured local plugin only from a directory (a file path is
 * skipped with a warning), so each plugin is a directory holding its entry
 * (`index.js`) and a `package.json` marking it an ES module, without a
 * package name, so Kilo resolves the conventional entry. Desktop's plugins are
 * dependency-free bundles, so Kilo never installs anything for them.
 */
export function managedKiloPluginDirectory(runtimeDirectory: string): string {
	return path.join(runtimeDirectory, "kilo-plugins");
}

export const MANAGED_PLUGIN_ENTRY = "index.js";
const MANAGED_PLUGIN_MANIFEST = `${JSON.stringify({ private: true, type: "module" })}\n`;

/** The managed plugins Kilo should load: every directory holding an entry, in a stable order. */
export async function listManagedKiloPlugins(directory: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}
	const candidates = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(directory, entry.name))
		.sort();
	const present = await Promise.all(
		candidates.map((candidate) =>
			stat(path.join(candidate, MANAGED_PLUGIN_ENTRY)).then(
				(info) => info.isFile(),
				() => false,
			),
		),
	);
	return candidates.filter((_, index) => present[index]);
}

/**
 * Writes one managed plugin (`<directory>/<name>/index.js` and its
 * `package.json`) atomically, so Kilo never imports a partial bundle. Resolves
 * whether the entry changed.
 */
export async function writeManagedKiloPlugin(
	directory: string,
	name: string,
	source: string | Buffer,
): Promise<boolean> {
	const pluginDirectory = path.join(directory, name);
	const entry = path.join(pluginDirectory, MANAGED_PLUGIN_ENTRY);
	const manifest = path.join(pluginDirectory, "package.json");
	const next = typeof source === "string" ? Buffer.from(source) : source;
	const [existing, existingManifest] = await Promise.all([
		readIfPresent(entry),
		readIfPresent(manifest),
	]);
	if (existing?.equals(next) && existingManifest?.toString("utf8") === MANAGED_PLUGIN_MANIFEST) {
		return false;
	}
	await mkdir(pluginDirectory, { recursive: true });
	await atomicWriteFile(manifest, MANAGED_PLUGIN_MANIFEST, { encoding: "utf8" });
	await atomicWriteFile(entry, next);
	return true;
}

/** Reads a managed plugin's entry, or undefined when it has none. */
export function readManagedKiloPlugin(
	directory: string,
	name: string,
): Promise<Buffer | undefined> {
	return readIfPresent(path.join(directory, name, MANAGED_PLUGIN_ENTRY));
}

export async function removeManagedKiloPlugin(directory: string, name: string): Promise<void> {
	await rm(path.join(directory, name), { recursive: true, force: true });
}

const LEGACY_MANAGED_PLUGIN_MARKER = "// Kilo Desktop managed plugin: ";
const LEGACY_CALLER_CONTEXT_FILENAME = "anaconda-desktop-caller-context.js";

/**
 * Kilo v1 builds kept Desktop's plugins as single files: `anaconda-*.js` in
 * the managed directory, and earlier still `anaconda-*.ts` bundles and the
 * caller-context plugin in `<config>/plugin/`. Kilo v2 never loads them, so
 * the files Desktop provably wrote are removed: those starting with its
 * ownership marker, and the generated caller-context plugin, which carried no
 * marker. An entry that cannot be processed must not block the rest, or the
 * same entry would stop cleanup on every launch; failures are reported at the
 * end.
 */
export async function removeLegacyKiloPluginFiles(directory: string): Promise<void> {
	let filenames: string[];
	try {
		filenames = await readdir(directory);
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
	const failures: string[] = [];
	await Promise.all(
		filenames.map(async (filename) => {
			try {
				await removeIfLegacyPlugin(path.join(directory, filename));
			} catch (error) {
				if (isMissingFileError(error)) return;
				failures.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
	);
	if (failures.length > 0) {
		throw new Error(`Could not remove ${failures.join("; ")}`);
	}
}

/** The v1 config directory's `plugin/` folder (see {@link removeLegacyKiloPluginFiles}). */
export function removeLegacyKiloConfigPlugins(configDirectory: string): Promise<void> {
	return removeLegacyKiloPluginFiles(path.join(configDirectory, "plugin"));
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
	if (!/^anaconda-.+\.[jt]s$/.test(path.basename(filePath))) return false;
	const contents = await readFile(filePath, "utf8");
	return contents.startsWith(LEGACY_MANAGED_PLUGIN_MARKER);
}

async function readIfPresent(filePath: string): Promise<Buffer | undefined> {
	try {
		return await readFile(filePath);
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw error;
	}
}
