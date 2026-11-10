import type { PullRequest, PullRequestEntry, PullRequestSnapshot } from "../../contracts";

export type PullRequestEntries = Readonly<Record<string, PullRequestEntry>>;

/** Snapshots older than this are not restored at start. */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * How long a just-created pull request outlives empty lookups. GitHub's
 * search can briefly miss a new PR; this spans the post-action settle
 * refreshes (2s and 8s) plus a slow `gh` round trip.
 */
const CREATED_PULL_REQUEST_GRACE_MS = 30_000;

/**
 * A snapshot that cannot name a branch (detached HEAD mid-rebase, an
 * unreadable status) says nothing about the branch's pull request, so it
 * does not replace one that found a PR; the next snapshot naming a branch
 * does. An empty answer on a named branch is authoritative: `gh` failures
 * reject before reaching here, and the lookup deliberately answers empty for
 * a PR a recreated branch name inherited. The one exception is a pull
 * request the user just created, which GitHub may not return yet.
 */
function isUninformative(
	previous: PullRequestEntry | undefined,
	next: PullRequestSnapshot,
	now: number,
): boolean {
	if (previous?.snapshot.pullRequest == null || next.pullRequest != null) return false;
	if (next.branch === null) return true;
	return (
		previous.createdAt !== undefined &&
		next.branch === previous.snapshot.branch &&
		now - previous.createdAt < CREATED_PULL_REQUEST_GRACE_MS
	);
}

/** The entries with `snapshot` recorded for `directory`, or the same entries when it says nothing new. */
export function withSnapshot(
	entries: PullRequestEntries,
	directory: string,
	snapshot: PullRequestSnapshot,
	now: number,
): PullRequestEntries {
	if (isUninformative(entries[directory], snapshot, now)) return entries;
	return { ...entries, [directory]: { snapshot, updatedAt: now } };
}

/**
 * Seeds a pull request the user just created, so the header never falls
 * back to "Create PR" while the background lookup catches up.
 */
export function withCreatedPullRequest(
	entries: PullRequestEntries,
	directory: string,
	branch: string,
	pullRequest: PullRequest,
	now: number,
): PullRequestEntries {
	const previous = entries[directory]?.snapshot;
	const snapshot: PullRequestSnapshot = {
		identity: previous?.identity ?? null,
		repository: previous?.repository ?? null,
		parentRepository: previous?.parentRepository ?? null,
		githubStatus: "ready",
		branch,
		pullRequest,
	};
	return { ...entries, [directory]: { snapshot, updatedAt: now, createdAt: now } };
}

/** Only the entries of `directories`; the same object when nothing is dropped. */
export function keepDirectories(
	entries: PullRequestEntries,
	directories: ReadonlySet<string>,
): PullRequestEntries {
	const kept = Object.entries(entries).filter(([directory]) => directories.has(directory));
	return kept.length === Object.keys(entries).length ? entries : Object.fromEntries(kept);
}

/** Saved entries still young enough to show; anything unreadable is dropped. */
export function restoreEntries(saved: unknown, now: number): PullRequestEntries {
	if (!saved || typeof saved !== "object") return {};
	return Object.fromEntries(
		Object.entries(saved as Record<string, Partial<PullRequestEntry> | null>).filter(
			([, entry]) =>
				typeof entry?.updatedAt === "number" &&
				typeof entry.snapshot === "object" &&
				entry.snapshot !== null &&
				now - entry.updatedAt <= SNAPSHOT_MAX_AGE_MS,
		),
	) as PullRequestEntries;
}
