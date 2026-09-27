import { create } from "zustand";

import type { SdkChannelResult } from "@kilo-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";

export type GitPrStatusTarget = { id: string; directory: string; active: boolean; branch?: string };
export type GitPrSnapshot = SdkChannelResult<GitServiceContract, "pullRequestSnapshot">;
export type GithubCapabilityStatus = SdkChannelResult<
	GitServiceContract,
	"githubCliStatus"
>["status"];
export type GitPullRequest = NonNullable<GitPrSnapshot["pullRequest"]>;
export type PersistedGitPrSnapshot = {
	snapshot: GitPrSnapshot;
	updatedAt: number;
	/** Set when the snapshot was seeded by creating its pull request, not by a lookup. */
	createdAt?: number;
};

const STORAGE_KEY = "git.pr-status:v2";
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * How long a just-created pull request outlives empty lookups. GitHub's
 * search can briefly miss a new PR; this spans the post-action settle
 * refreshes (2s and 8s) plus a slow `gh` round trip.
 */
const CREATED_PULL_REQUEST_GRACE_MS = 30_000;

function readSnapshots(): Readonly<Record<string, PersistedGitPrSnapshot>> {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
		if (!value || typeof value !== "object") return {};
		const now = Date.now();
		return Object.fromEntries(
			Object.entries(value as Record<string, PersistedGitPrSnapshot>).filter(
				([, entry]) =>
					typeof entry?.updatedAt === "number" && now - entry.updatedAt <= SNAPSHOT_MAX_AGE_MS,
			),
		);
	} catch {
		return {};
	}
}

type GitPrStatusState = {
	targets: readonly GitPrStatusTarget[];
	snapshots: Readonly<Record<string, PersistedGitPrSnapshot>>;
	githubStatus: { status: GithubCapabilityStatus; checkedAt: number } | null;
	refreshRequests: Readonly<Record<string, { id: number; settle: boolean }>>;
	/**
	 * Set when a user-initiated pull request action finds the GitHub CLI
	 * unusable; the provider turns it into setup guidance. Background polling
	 * never sets it, so users without `gh` are not nagged.
	 */
	githubSetupRequest: { id: number; status: Exclude<GithubCapabilityStatus, "ready"> } | null;
	setTargets: (targets: readonly GitPrStatusTarget[]) => void;
	clearTargets: () => void;
	setSnapshot: (id: string, snapshot: GitPrSnapshot) => void;
	/**
	 * Shows a pull request the user just created on every target in its
	 * directory, so the header never falls back to "Create PR" while the
	 * background lookup catches up.
	 */
	recordCreatedPullRequest: (
		directory: string,
		branch: string,
		pullRequest: GitPullRequest,
	) => void;
	setGithubStatus: (status: GithubCapabilityStatus) => void;
	refresh: (directory: string, settle?: boolean) => void;
	requestGithubSetup: (status: Exclude<GithubCapabilityStatus, "ready">) => void;
};

export function selectPullRequest(
	state: Pick<GitPrStatusState, "targets" | "snapshots">,
	query: { statusId?: string; directory?: string; branch?: string },
): GitPrSnapshot["pullRequest"] | null {
	const id = query.statusId
		? query.statusId
		: state.targets.find((target) => target.directory === query.directory)?.id;
	const snapshot = id ? state.snapshots[id]?.snapshot : undefined;
	if (query.branch && snapshot?.branch !== query.branch) return null;
	return snapshot?.pullRequest ?? null;
}

/**
 * A snapshot that cannot name a branch (detached HEAD mid-rebase, an
 * unreadable status) says nothing about the branch's pull request, so it
 * does not replace one that found a PR; the next snapshot naming a branch
 * does. Unlike the VS Code Agent Manager, an empty answer on a named branch
 * is authoritative: `gh` failures reject before reaching the store, and the
 * main process deliberately answers empty for a PR a recreated branch name
 * inherited. The one exception is a pull request the user just created,
 * which GitHub may not return yet.
 */
function isUninformativeSnapshot(
	previous: PersistedGitPrSnapshot | undefined,
	next: GitPrSnapshot,
): boolean {
	if (previous?.snapshot.pullRequest == null || next.pullRequest != null) return false;
	if (next.branch === null) return true;
	return (
		previous.createdAt !== undefined &&
		next.branch === previous.snapshot.branch &&
		Date.now() - previous.createdAt < CREATED_PULL_REQUEST_GRACE_MS
	);
}

function persistSnapshots(snapshots: Readonly<Record<string, PersistedGitPrSnapshot>>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
	} catch {
		// Memory cache remains usable when persistence is unavailable.
	}
}

export const useGitPrStatusStore = create<GitPrStatusState>((set) => ({
	targets: [],
	snapshots: readSnapshots(),
	githubStatus: null,
	refreshRequests: {},
	githubSetupRequest: null,
	setTargets: (targets) =>
		set((state) => {
			if (targets.length === 0) return { targets };
			if (
				state.targets.length === targets.length &&
				state.targets.every((target, index) => {
					const next = targets[index];
					return (
						next !== undefined &&
						target.id === next.id &&
						target.directory === next.directory &&
						target.active === next.active &&
						target.branch === next.branch
					);
				})
			) {
				return state;
			}
			const ids = new Set(targets.map((target) => target.id));
			const snapshots = Object.fromEntries(
				Object.entries(state.snapshots).filter(([id]) => ids.has(id)),
			);
			persistSnapshots(snapshots);
			return { targets, snapshots };
		}),
	clearTargets: () => set({ targets: [] }),
	setSnapshot: (id, snapshot) =>
		set((state) => {
			if (isUninformativeSnapshot(state.snapshots[id], snapshot)) return state;
			const snapshots = { ...state.snapshots, [id]: { snapshot, updatedAt: Date.now() } };
			persistSnapshots(snapshots);
			return { snapshots };
		}),
	recordCreatedPullRequest: (directory, branch, pullRequest) =>
		set((state) => {
			const now = Date.now();
			const seeded = state.targets
				.filter((target) => target.directory === directory)
				.map((target): [string, PersistedGitPrSnapshot] => {
					const previous = state.snapshots[target.id]?.snapshot;
					const snapshot: GitPrSnapshot = {
						identity: previous?.identity ?? null,
						repository: previous?.repository ?? null,
						parentRepository: previous?.parentRepository ?? null,
						githubStatus: "ready",
						branch,
						pullRequest,
					};
					return [target.id, { snapshot, updatedAt: now, createdAt: now }];
				});
			if (seeded.length === 0) return state;
			const snapshots = { ...state.snapshots, ...Object.fromEntries(seeded) };
			persistSnapshots(snapshots);
			return { snapshots };
		}),
	setGithubStatus: (status) => set({ githubStatus: { status, checkedAt: Date.now() } }),
	refresh: (directory, settle = false) =>
		set((state) => ({
			refreshRequests: {
				...state.refreshRequests,
				[directory]: { id: (state.refreshRequests[directory]?.id ?? 0) + 1, settle },
			},
		})),
	requestGithubSetup: (status) =>
		set((state) => ({
			githubSetupRequest: { id: (state.githubSetupRequest?.id ?? 0) + 1, status },
		})),
}));
