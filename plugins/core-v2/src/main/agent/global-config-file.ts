import { stat } from "node:fs/promises";
import path from "node:path";

import type { KiloGlobalConfigFile } from "./types.js";

/** Kilo v2's global config names, highest precedence first (`kilo2.jsonc` wins over `kilo2.json`). */
const GLOBAL_CONFIG_CANDIDATES = ["kilo2.jsonc", "kilo2.json"] as const;

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}

/**
 * The user's global Kilo config file: the first existing candidate, or the
 * file Kilo v2 would create (`kilo2.jsonc`) when none exists yet.
 */
export async function resolveGlobalConfigFile(directory: string): Promise<KiloGlobalConfigFile> {
	for (const name of GLOBAL_CONFIG_CANDIDATES) {
		const candidate = path.join(directory, name);
		if (await isFile(candidate)) return { path: candidate, exists: true };
	}
	return { path: path.join(directory, GLOBAL_CONFIG_CANDIDATES[0]), exists: false };
}
