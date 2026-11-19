import { existsSync, mkdirSync, realpathSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";

import { KernelError } from "@kilo-desktop/kernel";

import type { WorkspaceFolderInput } from "../../contracts/model";

const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/;

/** `rawName` trimmed, when it is one usable folder name; VALIDATION otherwise. */
export function validateFolderName(rawName: string): string {
	const name = rawName.trim();
	const invalid =
		!name ||
		name === "." ||
		name === ".." ||
		/[\\/]/.test(name) ||
		name.includes("\u0000") ||
		(process.platform === "win32" && WINDOWS_RESERVED_CHARACTERS.test(name));
	if (invalid) throw new KernelError("VALIDATION", `"${name}" can't be used as a folder name.`);
	return name;
}

/** `parentPath` with symlinks resolved, when it is an existing folder; VALIDATION otherwise. */
export function resolveParentFolder(parentPath: string): string {
	if (path.isAbsolute(parentPath)) {
		try {
			const resolved = realpathSync.native(parentPath);
			if (statSync(resolved).isDirectory()) return resolved;
		} catch {
			// Reported below, as for a relative path.
		}
	}
	throw new KernelError("VALIDATION", "Choose an existing folder location.");
}

function folderExistsError(name: string): KernelError {
	return new KernelError("VALIDATION", `A folder named "${name}" already exists in that location.`);
}

/** Where a new folder `name` goes in `parentPath`, checked to be free; nothing is created. */
export function newFolderPath(parentPath: string, name: string): string {
	const folderName = validateFolderName(name);
	const destination = path.join(resolveParentFolder(parentPath), folderName);
	if (existsSync(destination)) throw folderExistsError(folderName);
	return destination;
}

function makeEmptyFolder(destination: string): void {
	try {
		mkdirSync(destination);
	} catch (reason) {
		if ((reason as NodeJS.ErrnoException).code === "EEXIST") {
			throw folderExistsError(path.basename(destination));
		}
		throw reason;
	}
}

/**
 * Makes each of `createFolders` (which must also be one of `folders`) as an
 * empty folder, then saves the workspace with the folders' resolved paths.
 * Every folder is checked before any is made, and the ones made are removed
 * again if anything later fails, so a refused request leaves no empty
 * folders behind.
 */
export function withNewFolders<T>(
	folders: readonly WorkspaceFolderInput[],
	createFolders: readonly string[],
	save: (folders: WorkspaceFolderInput[]) => T,
): T {
	const listed = new Set(folders.map((folder) => folder.path));
	const planned = createFolders.map((requested) => {
		if (!listed.has(requested)) {
			throw new KernelError(
				"VALIDATION",
				"A new folder must also be one of the workspace's folders.",
			);
		}
		return {
			requested,
			destination: path.join(
				resolveParentFolder(path.dirname(requested)),
				validateFolderName(path.basename(requested)),
			),
		};
	});

	const made = new Map<string, string>();
	try {
		for (const { requested, destination } of planned) {
			makeEmptyFolder(destination);
			made.set(requested, destination);
		}
		return save(
			folders.map((folder) => ({ ...folder, path: made.get(folder.path) ?? folder.path })),
		);
	} catch (reason) {
		// rmdir (not rm -r) only removes a folder that is still empty, so
		// anything written into one meanwhile is never deleted.
		for (const folder of [...made.values()].reverse()) {
			try {
				rmdirSync(folder);
			} catch {
				// The original failure is the one to report.
			}
		}
		throw reason;
	}
}
