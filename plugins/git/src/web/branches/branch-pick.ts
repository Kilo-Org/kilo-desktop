import type { SessionIsolation } from "@kilo-desktop/plugin-sessions/contracts";

import type { GitWorktreeEntry } from "../../contracts/index.js";

export interface ResolveBranchPickInput {
	/** Contract `name` of the branch being checked out (short name, no `refs/heads/`). */
	readonly branch: string;
	readonly worktrees: ReadonlyArray<GitWorktreeEntry> | null | undefined;
	/** The repository's checkout — "Local" in the launcher's isolation menu. */
	readonly repositoryDirectory: string;
	/** The directory the current pick would otherwise check out in. */
	readonly workingDirectory: string;
}

export type BranchPickResolution =
	| {
			readonly kind: "retarget";
			readonly isolation: Extract<SessionIsolation, { kind: "local" | "existing-worktree" }>;
	  }
	| { readonly kind: "checkout" };

/**
 * Whether picking `branch` should move the new session to wherever that
 * branch is already checked out, instead of running `git checkout` in
 * `workingDirectory`. A remote-kind pick's display name (e.g.
 * `origin/develop`) never collides with a worktree's local branch name, so
 * it falls through to `{ kind: "checkout" }`.
 */
export function resolveBranchPick(input: ResolveBranchPickInput): BranchPickResolution {
	const match = input.worktrees?.find(
		(entry) => entry.branch === input.branch && entry.path !== input.workingDirectory,
	);
	if (!match) return { kind: "checkout" };
	if (match.isMain || match.path === input.repositoryDirectory) {
		return { kind: "retarget", isolation: { kind: "local" } };
	}
	return { kind: "retarget", isolation: { kind: "existing-worktree", directory: match.path } };
}
