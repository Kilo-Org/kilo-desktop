import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { GithubRepositories } from "../../contracts";
import type { RepositoryHandle } from "../shared/repository-queries";
import { gitUnavailable } from "./clone-errors";

export type GithubRepositoriesHandle = DomainObjectHandle<typeof GithubRepositories>;

/** Main caches `gh auth status` too; this only spares repeat calls within a dialog. */
const STATUS_STALE_MS = 60_000;
/** Backstop for a `refreshed` event that fired before this window listened. */
const REFRESHING_POLL_MS = 5_000;

export const GITHUB_STATUS_KEY = ["git", "githubCliStatus"] as const;
export const GITHUB_REPOSITORIES_KEY = ["git", "githubRepositories"] as const;

export function githubStatusQuery(repository: RepositoryHandle | null) {
	return queryOptions({
		queryKey: GITHUB_STATUS_KEY,
		queryFn: () => (repository ?? gitUnavailable()).methods.githubCliStatus({}),
		enabled: repository !== null,
		staleTime: STATUS_STALE_MS,
	});
}

/**
 * Always stale: main answers from its kept list, so reading is cheap, and
 * reading again on mount is how a list refreshed while the picker was closed
 * gets picked up.
 */
export function githubRepositoriesQuery(github: GithubRepositoriesHandle | null, enabled: boolean) {
	return queryOptions({
		queryKey: GITHUB_REPOSITORIES_KEY,
		queryFn: () => (github ?? gitUnavailable()).methods.list({}),
		enabled: enabled && github !== null,
		refetchInterval: (query) => (query.state.data?.refreshing ? REFRESHING_POLL_MS : false),
	});
}

/**
 * Starts loading the repository list when the New workspace dialog opens, so
 * a first-ever fetch (seconds on a large account) or a stale list's refresh
 * is under way before the person reaches the GitHub step. Only once the
 * GitHub CLI is signed in, so people who never clone don't fetch a list.
 */
export async function prefetchGithubRepositories(
	queries: QueryClient,
	repository: RepositoryHandle | null,
	github: GithubRepositoriesHandle | null,
): Promise<void> {
	if (!repository || !github) return;
	try {
		const { status } = await queries.fetchQuery(githubStatusQuery(repository));
		if (status === "ready") await queries.prefetchQuery(githubRepositoriesQuery(github, true));
	} catch {
		// Best effort: the GitHub step loads and reports failures itself.
	}
}

/** The repository list, read again when a background refresh main reported settles. */
export function useGithubRepositories(github: GithubRepositoriesHandle | null, enabled: boolean) {
	const query = useQuery(githubRepositoriesQuery(github, enabled));
	const refreshing = query.data?.refreshing === true;
	const { refetch } = query;
	useEffect(() => {
		if (!refreshing || !github) return;
		return github.on("refreshed", () => void refetch());
	}, [github, refreshing, refetch]);
	return query;
}
