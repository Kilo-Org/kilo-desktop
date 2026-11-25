import { stat } from "node:fs/promises";
import path from "node:path";

import type { KiloGlobalConfigFile } from "./types.js";

/**
 * Mirrors Kilo v2's global write candidates (`KiloConfigFiles.writeCandidates`):
 * the file it reads last, so the one that wins, comes first. v1's `kilo.json(c)`
 * is never read by v2.
 */
const GLOBAL_CONFIG_CANDIDATES = ["kilo2.jsonc", "kilo2.json"] as const;

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}

/**
 * The user's global Kilo config file: the first existing candidate, or
 * `kilo2.jsonc` (the file Kilo reads last) when none exists yet.
 */
export async function resolveGlobalConfigFile(directory: string): Promise<KiloGlobalConfigFile> {
	for (const name of GLOBAL_CONFIG_CANDIDATES) {
		const candidate = path.join(directory, name);
		if (await isFile(candidate)) return { path: candidate, exists: true };
	}
	return { path: path.join(directory, GLOBAL_CONFIG_CANDIDATES[0]), exists: false };
}
