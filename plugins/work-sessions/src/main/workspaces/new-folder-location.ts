import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { KvStore } from "@kilo-desktop/kernel";

import type { PersistedNewFolderLocation } from "../storage/stores";

function isDirectory(candidate: string | null | undefined): candidate is string {
	if (!candidate) return false;
	try {
		return statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

/** `~/Documents`, else the home folder. */
export function defaultDocumentsDirectory(): string {
	const documents = path.join(homedir(), "Documents");
	return isDirectory(documents) ? documents : homedir();
}

export interface NewFolderLocation {
	get(): string | null;
	remember(parentPath: string): void;
}

/**
 * Where new workspace folders (empty or cloned) go by default: the location
 * last used for one, else `documentsDirectory`. Only locations a folder was
 * actually made in are remembered, so one picked and then abandoned doesn't
 * stick, and a remembered location since deleted or unmounted is skipped.
 */
export function createNewFolderLocation(options: {
	store: Pick<KvStore<PersistedNewFolderLocation>, "get" | "set">;
	documentsDirectory: () => string | null;
}): NewFolderLocation {
	return {
		get() {
			const last = options.store.get("lastParentPath");
			if (isDirectory(last)) return last;
			const documents = options.documentsDirectory();
			return isDirectory(documents) ? documents : null;
		},
		remember(parentPath) {
			options.store.set({ lastParentPath: parentPath });
		},
	};
}
