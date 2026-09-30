/** The number of commits a revision range is ahead/behind. */
export interface IAheadBehind {
	readonly ahead: number;
	readonly behind: number;
}

export interface IBranchTip {
	readonly sha: string;
}

export interface IBranch {
	/**
	 * The ref minus `refs/heads/` or `refs/remotes/` (e.g. "main",
	 * "origin/main"), as `git branch` prints it. Not disambiguated against tags
	 * or other namespaces: pass `ref` where git expects a revision.
	 */
	readonly name: string;
	/** The upstream in the same form (e.g. "origin/main"), or `null` when untracked. */
	readonly upstream: string | null;
	readonly tip: IBranchTip;
	/** Canonical ref, e.g. "refs/heads/main". */
	readonly ref: string;
}
