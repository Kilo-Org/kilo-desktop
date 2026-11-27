import path from "node:path";

import { unzipSync } from "fflate";

import { KernelError } from "@kilo-desktop/kernel";

/**
 * Reads a local plugin shared as a zip: the plugin's folder zipped either
 * from inside (plugin.json at the top) or as the folder itself (one top-level
 * folder holding plugin.json, as Finder's Compress makes it).
 *
 * The archive is untrusted input, so nothing is written here: entries are
 * read into memory, with paths that could leave the plugin's folder refused,
 * declared sizes checked before anything is inflated and actual sizes after.
 * What the scanner ignores (dot entries, `node_modules`, macOS metadata) is
 * left out. The caller writes the files and validates the plugin like any.
 */
export interface ArchiveLimits {
	readonly maxFiles: number;
	readonly maxBytes: number;
}

const MANIFEST_FILE = "plugin.json";

function refuse(message: string): never {
	throw new KernelError("VALIDATION", message);
}

/** An entry's path inside the plugin, or undefined for directories and what the scanner ignores. */
function entryPath(name: string): string | undefined {
	const normalized = path.posix.normalize(name.replaceAll("\\", "/"));
	if (
		path.posix.isAbsolute(normalized) ||
		/^[A-Za-z]:/.test(normalized) ||
		normalized === ".." ||
		normalized.startsWith("../")
	) {
		refuse(`The archive has a file outside the plugin's folder ("${name}").`);
	}
	if (normalized.endsWith("/") || name.endsWith("/")) return undefined;
	const segments = normalized.split("/");
	if (segments[0] === "__MACOSX") return undefined;
	if (segments.some((segment) => segment.startsWith(".") || segment === "node_modules")) {
		return undefined;
	}
	return normalized;
}

export function readPluginArchive(
	archive: Uint8Array,
	limits: ArchiveLimits,
): Map<string, Uint8Array> {
	const tooLarge = () =>
		refuse(
			`The plugin is too large (over ${limits.maxFiles} files or ${limits.maxBytes / 1024 / 1024} MB unpacked).`,
		);
	let declaredFiles = 0;
	let declaredBytes = 0;
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(archive, {
			filter: (file) => {
				if (entryPath(file.name) === undefined) return false;
				declaredFiles += 1;
				declaredBytes += file.originalSize;
				if (declaredFiles > limits.maxFiles || declaredBytes > limits.maxBytes) tooLarge();
				return true;
			},
		});
	} catch (error) {
		if (error instanceof KernelError) throw error;
		refuse("That file isn't a zip archive.");
	}

	const files = new Map<string, Uint8Array>();
	let bytes = 0;
	for (const [name, content] of Object.entries(entries)) {
		const relative = entryPath(name);
		if (relative === undefined) continue;
		bytes += content.byteLength;
		if (bytes > limits.maxBytes) tooLarge();
		files.set(relative, content);
	}
	return unwrapSingleFolder(files);
}

/** Moves a plugin zipped as its folder up to the top, so plugin.json is at the root. */
function unwrapSingleFolder(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
	if (files.has(MANIFEST_FILE)) return files;
	const tops = new Set([...files.keys()].map((file) => file.split("/")[0]));
	const [top] = tops;
	if (tops.size === 1 && top !== undefined && files.has(`${top}/${MANIFEST_FILE}`)) {
		return new Map(
			[...files].map(([file, content]) => [file.slice(top.length + 1), content] as const),
		);
	}
	refuse(`The archive has no ${MANIFEST_FILE} at its top, or in a single folder at its top.`);
}
