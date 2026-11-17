import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { idsForShard, weighSpecFiles, type Shard } from "../../scripts/shard-plan.mjs";

const DURATIONS_FILE = path.join("scripts", "test-durations", "e2e.json");

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
	testMatch: readonly string[];
	ignore: readonly string[];
	shard: Shard;
	grep: RegExp | undefined;
}): string[] | undefined {
	const durations = readDurations(path.join(options.repoRoot, DURATIONS_FILE));
	if (!durations) return undefined;
	const files = globSync([...options.testMatch], { cwd: options.repoRoot })
		.map((file) => file.replaceAll("\\", "/"))
		.filter(
			(file) =>
				!options.ignore.some((glob) => path.matchesGlob(path.join(options.repoRoot, file), glob)),
		)
		.sort();
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

function readDurations(file: string): Record<string, Record<string, number>> | undefined {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, number>>;
	} catch {
		return undefined;
	}
}
