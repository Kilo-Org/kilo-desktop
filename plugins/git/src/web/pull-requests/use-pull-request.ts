import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	Workspaces,
	type WorkSession,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { PullRequests, Repository, type PullRequestEntry } from "../../contracts";
import { statusQuery } from "../shared/repository-queries";
import { visiblePullRequest, workSessionDirectory, type CheckedOutBranch } from "./select";

const NO_WORKSPACES: readonly Workspace[] = [];
const selectWorkspaces = (state: { workspaces: readonly Workspace[] }) => state.workspaces;

/** The directory a work session's pull request is looked up in. */
export function useWorkSessionDirectory(workSession: WorkSession): string | null {
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	return workSessionDirectory(workSession, workspaces);
}

/** The last pull request lookup for `directory`. */
export function usePullRequestEntry(directory: string | null): PullRequestEntry | undefined {
	const select = useCallback(
		(state: { byDirectory: Readonly<Record<string, PullRequestEntry>> }) =>
			directory ? state.byDirectory[directory] : undefined,
		[directory],
	);
	return useDomainObjectState(PullRequests, select);
}

/**
 * The checked-out branch as the window's cached `status` of the directory
 * last saw it. Reads, but never fetches: one `git status` per work session row
 * would be wasteful, and only the open work session's header keeps it current.
 */
export function useCachedCheckedOutBranch(directory: string | null): CheckedOutBranch | undefined {
	const repository = useDomainObject(Repository);
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
