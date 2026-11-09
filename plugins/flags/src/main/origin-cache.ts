import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Copies origin's LaunchDarkly cache (`<userData>/launchdarkly`) into this
 * plugin's folder when it has none yet, so the first launch offline still
 * serves the flags origin last saw instead of defaults. The copy is made
 * beside the target and renamed into place, so an interrupted copy is never
 * taken for a cache; origin's is left for a downgrade. Synchronous: it runs
 * before the LaunchDarkly client opens the folder, and the cache is small.
 */
export function adoptOriginCache(originDir: string, ownDir: string): void {
	if (existsSync(ownDir) || !existsSync(originDir)) return;
	const partial = `${ownDir}.importing`;
	rmSync(partial, { recursive: true, force: true });
	mkdirSync(path.dirname(ownDir), { recursive: true });
	cpSync(originDir, partial, { recursive: true });
	renameSync(partial, ownDir);
}
