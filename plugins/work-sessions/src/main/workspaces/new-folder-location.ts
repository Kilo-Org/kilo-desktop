import { homedir } from "node:os";
import path from "node:path";

import type { KvStore } from "@kilo-desktop/kernel";

import type { PersistedNewFolderLocation } from "../storage/stores";
import { isAvailableDirectory } from "./folders";

/** `~/Documents`, then the home folder. */
export function defaultLocations(): readonly string[] {
	return [path.join(homedir(), "Documents"), homedir()];
}

export interface NewFolderLocation {
	get(): Promise<string | null>;
	remember(parentPath: string): void;
}

/**
 * Where new workspace folders (empty or cloned) go by default: the location
 * last used for one, else the first of `defaults` that exists. Only locations
 * a folder was actually made in are remembered, so one picked and then
 * abandoned doesn't stick, and a remembered location since deleted or
 * unmounted is skipped. Each candidate is probed asynchronously with a
 * timeout, so an offline mount can't stall the main process.
 */
export function createNewFolderLocation(options: {
	store: Pick<KvStore<PersistedNewFolderLocation>, "get" | "set">;
	defaults: () => readonly (string | null)[];
}): NewFolderLocation {
	return {
		async get() {
			const candidates = [options.store.get("lastParentPath"), ...options.defaults()];
			for (const candidate of candidates) {
				if (candidate && (await isAvailableDirectory(candidate))) return candidate;
			}
			return null;
		},
		remember(parentPath) {
			options.store.set({ lastParentPath: parentPath });
		},
	};
}
