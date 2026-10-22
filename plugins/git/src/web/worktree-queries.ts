import { queryOptions } from "@tanstack/react-query";

import type { SDK } from "@kilo-desktop/feature-sdk";
import { sdkQueryOptions } from "@kilo-desktop/sdk-react";

import type { GitServiceContract, GitWorktreeEntry } from "../contracts/schemas.js";

/**
 * TTL for the worktree list (kilocode's `FETCH_CACHE_TTL`). Freshness
 * beyond the TTL comes from `refetchOnWindowFocus: "always"` (every
 * tab-back refetches, even inside the TTL) plus invalidation on checkout
 * success and error — no file watcher is involved.
 */
export const WORKTREES_STALE_TIME_MS = 60_000;

/**
 * Query options for the in-workspace worktree list, always keyed by the
 * *workspace* directory (never the worktree directory) so `GitDraftMenus`
 * and `GitBranchSelector` share one cache entry regardless of which
 * worktree the draft currently targets — the list is the same from any
 * worktree in the repository.
 */
export function worktreesQueryOptions(sdk: SDK<GitServiceContract>, workspaceDirectory: string) {
	return queryOptions({
		...sdkQueryOptions(sdk, "worktrees", { workingDirectory: workspaceDirectory }),
		staleTime: WORKTREES_STALE_TIME_MS,
		refetchOnWindowFocus: "always",
	});
}

/**
 * The workspace's linked (non-main) worktrees — the workspace checkout
 * itself is "Local" and never listed alongside its own worktrees. Pure
 * and applied at render time; the list is tiny, so no `select` memo.
 */
export function linkedWorktrees(
	entries: ReadonlyArray<GitWorktreeEntry> | null | undefined,
	workspaceDirectory: string,
): GitWorktreeEntry[] {
	if (!entries) return [];
	return entries.filter((entry) => !entry.isMain && entry.path !== workspaceDirectory);
}
