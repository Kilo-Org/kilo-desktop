/** The number of commits a revision range is ahead/behind. */
export interface IAheadBehind {
	readonly ahead: number;
	readonly behind: number;
}

export interface IBranchTip {
	readonly sha: string;
}

export interface IBranch {
	/** Short name, e.g. "main". */
	readonly name: string;
	/** Remote-prefixed upstream short name, or `null` when untracked. */
	readonly upstream: string | null;
	readonly tip: IBranchTip;
	/** Canonical ref, e.g. "refs/heads/main". */
	readonly ref: string;
}
