import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

/** True while a version control contribution (kilo.git) is present. */
export const HAS_VCS_KEY = "kilo.work-sessions/hasVcs";

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

/**
 * An isolated copy of a repository inside a workspace folder (for git, a
 * worktree); detached and stale ones are left out.
 */
export interface VcsCopy {
	readonly path: string;
	readonly name: string;
	readonly branch: string;
	/** The repository's own checkout. */
	readonly isMain: boolean;
}

export interface VcsCreatedCopy {
	readonly directory: string;
	readonly branch: string;
	/** Created from a degraded base, e.g. the base branch could not be fetched. */
	readonly warning?: string | undefined;
	/** The ref the branch was cut from; absent when cut from HEAD. */
	readonly baseRef?: string | undefined;
}

/**
 * What kilo.work-sessions and other plugins need from version control, in
 * main: a folder's status and branches, and the isolated copies work
 * sessions run in. Copies the app creates live at
 * `<folder>/.kilo/worktrees/<name>` (`KILO_WORKTREE_SEGMENTS`) on branches
 * the contribution marks as its own (`isManagedBranch`); paths given to it
 * are checked against workspace folders by the contribution where a renderer
 * could have chosen them.
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
	/** The repository's copies inside workspace folders, its own checkout first; null outside a repository. */
	copies(directory: string): Promise<readonly VcsCopy[] | null>;
	/**
	 * A new managed copy of the repository at `directory`, on a new branch cut
	 * from `baseBranch` (default: the default branch, else HEAD). `branch`
	 * names it (made unique); otherwise a generated name is used.
	 */
	createCopy(input: {
		readonly directory: string;
		readonly baseBranch?: string;
		readonly branch?: string;
	}): Promise<VcsCreatedCopy>;
	/** Checks `copy` is still a copy of the repository at `directory` and reads its branch; rejects NOT_FOUND. */
	resolveCopy(input: {
		readonly directory: string;
		readonly copy: string;
	}): Promise<{ readonly directory: string; readonly branch: string }>;
	/**
	 * Removes a managed copy; idempotent. Its branch is deleted too when the
	 * contribution owns it, unless `deleteBranch` is false.
	 */
	removeCopy(input: { readonly directory: string; readonly deleteBranch?: boolean }): Promise<void>;
	/** Renames a managed copy's unpublished branch, best effort; null when declined. */
	renameCopyBranch(input: {
		readonly directory: string;
		readonly currentBranch: string;
		readonly requestedBranch: string;
	}): Promise<{ readonly branch: string } | null>;
	/** Whether a copy has uncommitted changes or commits ahead of `baseBranch`. */
	hasCopyWork(input: {
		readonly directory: string;
		readonly baseBranch?: string;
	}): Promise<boolean>;
	/** Whether `branch` carries the contribution's ownership marker (removed with its copy). */
	isManagedBranch(branch: string): boolean;
	/**
	 * Tells the VS Code Agent Manager which chat (an Agent Manager "session")
	 * a managed copy belongs to; true when written.
	 */
	linkAgentManagerSession(input: {
		readonly directory: string;
		readonly chatId: string;
		readonly baseRef?: string;
	}): Promise<boolean>;
}

/**
 * Version control for workspace folders. One contribution wins (kilo.git);
 * without one, work sessions run in the local checkout only.
 */
export const Vcs = defineExtensionPoint({
	id: "kilo.work-sessions/vcs",
	kind: "exclusive",
	description:
		"Version control for workspace folders: status, branches and the isolated copies work sessions run in.",
	implementation: implementation<VcsImplementation>("main"),
});
