import { globSync } from "node:fs";
import path from "node:path";

import { unregisteredSpecGlobs } from "./registered-specs.ts";

/**
 * Which spec files the suite runs, shared by playwright.config.ts and the CI
 * planner (e2e/scripts/plan-pr-e2e.ts). Node built-ins only, so the planner
 * runs before `pnpm install`.
 */
export const SPEC_TEST_MATCH = ["e2e/specs/**/*.spec.ts", "plugins/*/e2e/specs/**/*.spec.ts"];

/**
 * Absolute globs, because testIgnore matches absolute paths. Anchoring to
 * repoRoot keeps a .kilo/worktrees/<name> checkout (where repoRoot is inside
 * .kilo/worktrees/) discovering its own tests while ignoring sibling
 * worktrees. Specs of plugins not yet rebuilt on the kernel are skipped until
 * registered.
 */
export function specIgnoreGlobs(repoRoot: string): string[] {
	return [
		path.join(repoRoot, ".kilo", "**"),
		path.join(repoRoot, "node_modules", "**"),
		...unregisteredSpecGlobs(repoRoot),
	];
}

/** Repo-relative posix paths of every spec file the suite runs, sorted. */
export function discoverSpecFiles(repoRoot: string): string[] {
	const ignore = specIgnoreGlobs(repoRoot);
	return globSync(SPEC_TEST_MATCH, { cwd: repoRoot })
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => !ignore.some((glob) => path.matchesGlob(path.join(repoRoot, file), glob)))
		.sort();
}
