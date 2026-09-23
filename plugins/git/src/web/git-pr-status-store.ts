import { create } from "zustand";

import type { SdkChannelResult } from "@kilo-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";

export type GitPrStatusTarget = { id: string; directory: string; active: boolean; branch?: string };
export type GitPrSnapshot = SdkChannelResult<GitServiceContract, "pullRequestSnapshot">;
export type GithubCapabilityStatus = SdkChannelResult<
	GitServiceContract,
	"githubCliStatus"
>["status"];
export type PersistedGitPrSnapshot = { snapshot: GitPrSnapshot; updatedAt: number };

const STORAGE_KEY = "git.pr-status:v2";
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;

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
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
			} catch {
				// Memory cache remains usable when persistence is unavailable.
			}
			return { targets, snapshots };
		}),
	clearTargets: () => set({ targets: [] }),
	setSnapshot: (id, snapshot) =>
		set((state) => {
			const snapshots = { ...state.snapshots, [id]: { snapshot, updatedAt: Date.now() } };
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
			} catch {
				// Memory cache remains usable when persistence is unavailable.
			}
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
