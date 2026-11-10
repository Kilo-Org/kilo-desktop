import type { PullRequestSnapshot } from "../../contracts";

/** Pull request lookups for checkouts: the repository area's git service, or a test's stand-in. */
export interface PullRequestSource {
	snapshot(directory: string): Promise<PullRequestSnapshot>;
	/** At most `MAX_BATCHED_DIRECTORIES`; a null snapshot was not answered. */
	snapshots(
		directories: readonly string[],
	): Promise<readonly { directory: string; snapshot: PullRequestSnapshot | null }[]>;
}
