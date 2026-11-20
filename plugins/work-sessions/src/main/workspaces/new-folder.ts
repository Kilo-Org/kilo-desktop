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

/** Why a folder couldn't be made, as copy that survives the IPC boundary. */
function mkdirFailure(reason: unknown, name: string): unknown {
	switch ((reason as NodeJS.ErrnoException).code) {
		case "EEXIST":
			return folderExistsError(name);
		case "EACCES":
		case "EPERM":
			return new KernelError(
				"BUSINESS",
				"You don't have permission to create a folder in that location. Choose another location.",
			);
		case "EROFS":
			return new KernelError(
				"BUSINESS",
				"That location is read-only. Choose another location for the new folder.",
			);
		case "ENOSPC":
			return new KernelError("BUSINESS", "There isn't enough disk space to create the folder.");
		case "ENAMETOOLONG":
			return new KernelError("VALIDATION", `"${name}" is too long for a folder name.`);
		default:
			return new KernelError("BUSINESS", `The folder "${name}" couldn't be created.`);
	}
}

function makeEmptyFolder(destination: string): void {
	try {
		mkdirSync(destination);
	} catch (reason) {
		throw mkdirFailure(reason, path.basename(destination));
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
		// A `..` segment would put the folder outside the location it names.
		if (requested.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) {
			throw new KernelError("VALIDATION", "A new folder's path can't contain . or .. segments.");
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
