import { readFileSync } from "node:fs";
import path from "node:path";

import { idsForShard, weighSpecFiles, type Shard } from "../../scripts/shard-plan.mjs";
import { discoverSpecFiles } from "./spec-files.ts";

const DURATIONS_FILE = path.join("scripts", "test-durations", "e2e.json");

export type SpecDurations = Record<string, Record<string, number>>;

/**
 * The spec files one CI shard runs, balanced by recorded test time instead of
 * Playwright's even split by count (which can stack the slow specs on one
 * shard). Every shard discovers the same files and computes the same plan, so
 * each spec runs in exactly one shard.
 *
 * Returns repo-relative posix paths, or undefined to fall back to Playwright's
 * own `shard` when no durations are recorded.
 */
export function specFilesForShard(options: {
	repoRoot: string;
	shard: Shard;
	grep: RegExp | undefined;
}): string[] | undefined {
	const durations = readSpecDurations(options.repoRoot);
	if (!durations) return undefined;
	const files = discoverSpecFiles(options.repoRoot);
	return idsForShard(files, weighSpecFiles(files, durations, options.grep), options.shard);
}

/** Matches exactly one repo-relative spec file, with either path separator. */
export function specFilePattern(file: string): RegExp {
	const escaped = file
		.split("/")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("[\\\\/]");
	return new RegExp(`(^|[\\\\/])${escaped}$`);
}

export function readSpecDurations(repoRoot: string): SpecDurations | undefined {
	try {
		return JSON.parse(readFileSync(path.join(repoRoot, DURATIONS_FILE), "utf8")) as SpecDurations;
	} catch {
		return undefined;
	}
}
