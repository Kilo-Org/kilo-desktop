import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Copies an earlier LaunchDarkly cache into kilo.core's folder when it has
 * none yet, so the first launch offline still serves the flags last seen
 * instead of defaults. `earlierDirs` are tried newest first (kilo.flags',
 * then origin's `<userData>/launchdarkly`); the first that exists wins. The
 * copy is made beside the target and renamed into place, so an interrupted
 * copy is never taken for a cache; the earlier one is left for a downgrade.
 * Synchronous: it runs before the LaunchDarkly client opens the folder, and
 * the cache is small.
 */
export function adoptEarlierCache(earlierDirs: readonly string[], ownDir: string): void {
	if (existsSync(ownDir)) return;
	const earlier = earlierDirs.find((dir) => existsSync(dir));
	if (earlier === undefined) return;
	const partial = `${ownDir}.importing`;
	rmSync(partial, { recursive: true, force: true });
	mkdirSync(path.dirname(ownDir), { recursive: true });
	cpSync(earlier, partial, { recursive: true });
	renameSync(partial, ownDir);
}
