import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

/** True while a version control provider is present (kilo.git). */
export const VCS_KEY = "kilo.workspaces/vcs";

export type VcsFileStatusKind =
	| "New"
	| "Modified"
	| "Deleted"
	| "Copied"
	| "Renamed"
	| "Untracked"
	| "Conflicted";

/** One changed file in a working directory; `path` is relative to the repository root. */
export interface VcsFileChange {
	readonly path: string;
	readonly status: {
		readonly kind: VcsFileStatusKind;
		/** The path before a copy or rename. */
		readonly oldPath?: string;
	};
}

export interface VcsStatus {
	/** Absent on a detached HEAD. */
	readonly currentBranch?: string | undefined;
	readonly currentUpstreamBranch?: string | undefined;
	readonly currentTip?: string | undefined;
	readonly branchAheadBehind?: { readonly ahead: number; readonly behind: number } | undefined;
	readonly exists: boolean;
	readonly workingDirectory: { readonly files: readonly VcsFileChange[] };
	readonly doConflictedFilesExist: boolean;
}

export interface VcsBranch {
	readonly name: string;
	readonly upstream: string | null;
	readonly tip: { readonly sha: string };
	readonly ref: string;
	readonly kind: "local" | "remote";
}

export interface VcsBranches {
	readonly currentBranch?: string | undefined;
	/** Local branches, then remote-tracking branches no local branch tracks. */
	readonly branches: readonly VcsBranch[];
	readonly defaultBranch?: string | undefined;
	/** Recently checked-out local branches, most recent first. */
	readonly recentBranches: readonly string[];
}

/** A worktree inside a workspace folder; detached and stale ones are left out. */
export interface VcsWorktree {
	readonly path: string;
	readonly name: string;
	readonly branch: string;
	/** The repository's own checkout. */
	readonly isMain: boolean;
}

export interface VcsCreatedWorktree {
	readonly directory: string;
	readonly branch: string;
	/** Created from a degraded base, e.g. the base branch could not be fetched. */
	readonly warning?: string | undefined;
	/** The ref the branch was cut from; absent when cut from HEAD. */
	readonly baseRef?: string | undefined;
}

/**
 * What other plugins need from version control, in main: a folder's status
 * and branches, and the managed worktrees sessions run in. Worktrees live at
 * `<folder>/.kilo/worktrees/<name>` on branches the provider marks as its own
 * (`isManagedBranch`); paths given to it are checked against workspace folders
 * by the provider where a renderer could have chosen them.
 */
export interface VcsImplementation {
	/** Whether the version control tool can run at all; never rejects. */
	available(): Promise<boolean>;
	/** Null when `directory` is not in a repository. */
	status(directory: string): Promise<VcsStatus | null>;
	/** Null when `directory` is not in a repository. */
	branches(directory: string): Promise<VcsBranches | null>;
	/** The default branch (remote HEAD, else `main`, else `master`), or null. */
	defaultBranch(directory: string): Promise<string | null>;
	/** The repository's worktrees inside workspace folders, its own checkout first; null outside a repository. */
	worktrees(directory: string): Promise<readonly VcsWorktree[] | null>;
	/**
	 * A new managed worktree for the repository at `directory`, on a new branch
	 * cut from `baseBranch` (default: the default branch, else HEAD). `branch`
	 * names it (made unique); otherwise a generated name is used.
	 */
	createWorktree(input: {
		readonly directory: string;
		readonly baseBranch?: string;
		readonly branch?: string;
	}): Promise<VcsCreatedWorktree>;
	/** Checks `worktree` is still a worktree of the repository at `directory` and reads its branch; rejects NOT_FOUND. */
	resolveWorktree(input: {
		readonly directory: string;
		readonly worktree: string;
	}): Promise<{ readonly directory: string; readonly branch: string }>;
	/**
	 * Removes a managed worktree; idempotent. Its branch is deleted too when the
	 * provider owns it, unless `deleteBranch` is false.
	 */
	removeWorktree(input: {
		readonly directory: string;
		readonly deleteBranch?: boolean;
	}): Promise<void>;
	/** Renames a managed worktree's unpublished branch, best effort; null when declined. */
	renameWorktreeBranch(input: {
		readonly directory: string;
		readonly currentBranch: string;
		readonly requestedBranch: string;
	}): Promise<{ readonly branch: string } | null>;
	/** Whether a worktree has uncommitted changes or commits ahead of `baseBranch`. */
	hasWorktreeWork(input: {
		readonly directory: string;
		readonly baseBranch?: string;
	}): Promise<boolean>;
	/** Whether `branch` carries the provider's ownership marker (removed with its worktree). */
	isManagedBranch(branch: string): boolean;
	/** Tells the VS Code Agent Manager which session a managed worktree belongs to; true when written. */
	linkAgentManagerSession(input: {
		readonly directory: string;
		readonly sessionId: string;
		readonly baseRef?: string;
	}): Promise<boolean>;
}

/** Version control for workspace folders. One provider wins (kilo.git). */
export const Vcs = defineExtensionPoint({
	id: "kilo.workspaces/vcs",
	kind: "exclusive",
	description: "Version control for workspace folders: status, branches and worktrees.",
	implementation: implementation<VcsImplementation>("main"),
});
