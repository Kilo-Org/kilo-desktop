import { stat } from "node:fs/promises";
import path from "node:path";

import type { KiloGlobalConfigFile } from "../contracts/schemas.js";

/** Mirrors the Kilo CLI's `globalConfigFile()` candidate order. */
const GLOBAL_CONFIG_CANDIDATES = [
	"kilo.jsonc",
	"kilo.json",
	"opencode.jsonc",
	"opencode.json",
	"config.json",
] as const;

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}

/**
 * The user's global Kilo config file: the first existing candidate, or the
 * file Kilo would create (`kilo.jsonc`) when none exists yet.
 */
export async function resolveGlobalConfigFile(directory: string): Promise<KiloGlobalConfigFile> {
	for (const name of GLOBAL_CONFIG_CANDIDATES) {
		const candidate = path.join(directory, name);
		if (await isFile(candidate)) return { path: candidate, exists: true };
	}
	return { path: path.join(directory, GLOBAL_CONFIG_CANDIDATES[0]), exists: false };
}
