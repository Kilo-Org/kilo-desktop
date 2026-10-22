import type { GitDraftWorktreeSelection, GitWorktreeEntry } from "../contracts/schemas.js";

export interface ResolveBranchPickInput {
	/** Contract `name` of the branch being checked out (short name, no `refs/heads/`). */
	readonly branch: string;
	readonly worktrees: ReadonlyArray<GitWorktreeEntry> | null | undefined;
	/** The repository's checkout — "Local" in the draft mode menu. */
	readonly workspaceDirectory: string;
	/** The directory the current pick would otherwise check out in. */
	readonly workingDirectory: string;
}

export type BranchPickResolution =
	| { readonly kind: "retarget"; readonly selection: GitDraftWorktreeSelection }
	| { readonly kind: "checkout" };

/**
 * Whether picking `branch` should silently retarget the draft to wherever
 * that branch is already checked out, instead of running `git checkout`
 * in `workingDirectory`. A remote-kind pick's display name (e.g.
 * `origin/develop`) never collides with a worktree's local branch name,
 * so it naturally falls through to `{ kind: "checkout" }` — the existing
 * "Could not switch branches" toast and `worktrees` invalidation handle
 * that case without special-casing it here.
 */
export function resolveBranchPick(input: ResolveBranchPickInput): BranchPickResolution {
	const match = input.worktrees?.find(
		(entry) => entry.branch === input.branch && entry.path !== input.workingDirectory,
	);
	if (!match) return { kind: "checkout" };
	if (match.isMain || match.path === input.workspaceDirectory) {
		return { kind: "retarget", selection: { mode: "local" } };
	}
	return { kind: "retarget", selection: { mode: "existing-worktree", directory: match.path } };
}
