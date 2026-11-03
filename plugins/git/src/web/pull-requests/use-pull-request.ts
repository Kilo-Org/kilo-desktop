import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import type { Session } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-workspaces/contracts";

import { PullRequests, Repository, type PullRequestEntry } from "../../contracts/index.js";
import { statusQuery } from "../repository-queries.js";
import { sessionDirectory, visiblePullRequest, type CheckedOutBranch } from "./select.js";

const NO_WORKSPACES: readonly Workspace[] = [];
const selectWorkspaces = (state: { workspaces: readonly Workspace[] }) => state.workspaces;

/** The directory a session's pull request is looked up in. */
export function useSessionDirectory(session: Session): string | null {
	const workspaces = useDomainState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	return sessionDirectory(session, workspaces);
}

/** The last pull request lookup for `directory`. */
export function usePullRequestEntry(directory: string | null): PullRequestEntry | undefined {
	const select = useCallback(
		(state: { byDirectory: Readonly<Record<string, PullRequestEntry>> }) =>
			directory ? state.byDirectory[directory] : undefined,
		[directory],
	);
	return useDomainState(PullRequests, select);
}

/**
 * The checked-out branch as the window's cached `status` of the directory
 * last saw it. Reads, but never fetches: one `git status` per session row
 * would be wasteful, and only the open session's header keeps it current.
 */
export function useCachedCheckedOutBranch(directory: string | null): CheckedOutBranch | undefined {
	const repository = useDomain(Repository);
	const { data, dataUpdatedAt } = useQuery({
		...statusQuery(repository, directory ?? ""),
		enabled: false,
	});
	return data ? { branch: data.currentBranch, observedAt: dataUpdatedAt } : undefined;
}

/** A directory's pull request as the header shows it. */
export function useDirectoryPullRequest(directory: string | null) {
	const entry = usePullRequestEntry(directory);
	const checkedOut = useCachedCheckedOutBranch(directory);
	return visiblePullRequest(entry, checkedOut);
}
