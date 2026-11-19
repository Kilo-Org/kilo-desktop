import {
	QueryClient,
	QueryClientProvider,
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import type { ComponentType } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { Repository } from "../../contracts";

export type RepositoryHandle = DomainObjectHandle<typeof Repository>;

/** Repository reads cached in a window, keyed `["git", method, {directory}]`. */
export type RepositoryQueryMethod =
	| "repositoryType"
	| "branches"
	| "worktrees"
	| "status"
	| "originUrl"
	| "workingTreeStats";

/** TTL for the worktree list; freshness beyond it comes from refetching on window focus. */
export const WORKTREES_STALE_TIME_MS = 60_000;

export function createGitQueryClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function repositoryQueryKey(method: RepositoryQueryMethod, directory?: string) {
	return directory === undefined ? ["git", method] : ["git", method, { directory }];
}

function unavailable(): never {
	throw new Error("Git isn't available.");
}

export function repositoryTypeQuery(repository: RepositoryHandle | null, directory: string) {
	return queryOptions({
		queryKey: repositoryQueryKey("repositoryType", directory),
		queryFn: () => repository?.methods.repositoryType({ directory }) ?? unavailable(),
		enabled: repository !== null && directory !== "",
	});
}

export function branchesQuery(repository: RepositoryHandle | null, directory: string) {
	return queryOptions({
		queryKey: repositoryQueryKey("branches", directory),
		queryFn: () => repository?.methods.branches({ directory }) ?? unavailable(),
		enabled: repository !== null && directory !== "",
	});
}

export function statusQuery(repository: RepositoryHandle | null, directory: string) {
	return queryOptions({
		queryKey: repositoryQueryKey("status", directory),
		queryFn: () => repository?.methods.status({ directory }) ?? unavailable(),
		enabled: repository !== null && directory !== "",
	});
}

export function originUrlQuery(repository: RepositoryHandle | null, directory: string) {
	return queryOptions({
		queryKey: repositoryQueryKey("originUrl", directory),
		queryFn: () => repository?.methods.originUrl({ directory }) ?? unavailable(),
		enabled: repository !== null && directory !== "",
	});
}

export function workingTreeStatsQuery(repository: RepositoryHandle | null, directory: string) {
	return queryOptions({
		queryKey: repositoryQueryKey("workingTreeStats", directory),
		queryFn: () => repository?.methods.workingTreeStats({ directory }) ?? unavailable(),
		enabled: repository !== null && directory !== "",
	});
}

/**
 * The repository's worktrees, keyed by the checkout's directory so every
 * view of the repository shares one entry.
 */
export function worktreesQuery(repository: RepositoryHandle | null, directory: string) {
	return queryOptions({
		queryKey: repositoryQueryKey("worktrees", directory),
		queryFn: () => repository?.methods.worktrees({ directory }) ?? unavailable(),
		enabled: repository !== null && directory !== "",
		staleTime: WORKTREES_STALE_TIME_MS,
		refetchOnWindowFocus: "always",
	});
}

/** Refetches the cached reads of `methods` for every directory. */
export function invalidateRepositoryQueries(
	queries: QueryClient,
	methods: readonly RepositoryQueryMethod[],
): Promise<void> {
	return Promise.all(
		methods.map((method) => queries.invalidateQueries({ queryKey: repositoryQueryKey(method) })),
	).then(() => undefined);
}

export interface InitRepository {
	readonly isPending: boolean;
	/** Makes `directory` a repository; `onSuccess` runs after the cached reads are refreshed. */
	init(directory: string, onSuccess?: () => void): void;
}

/** `repository.init`, refreshing what depends on a folder being a repository; failures toast. */
export function useInitRepository(): InitRepository {
	const repository = useDomainObject(Repository);
	const queries = useQueryClient();
	const mutation = useMutation({
		mutationFn: (directory: string) => repository?.methods.init({ directory }) ?? unavailable(),
		onSuccess: () => invalidateRepositoryQueries(queries, ["repositoryType", "branches", "status"]),
	});
	return {
		isPending: mutation.isPending,
		init: (directory, onSuccess) =>
			mutation.mutate(directory, {
				...(onSuccess ? { onSuccess } : {}),
				onError: (error) =>
					toast.error("Could not initialize git", {
						description: error instanceof Error ? error.message : "Unknown git error.",
					}),
			}),
	};
}

/** Renders `Component` over the window's repository cache. */
export function withRepositoryQueries<TProps extends object>(
	queries: QueryClient,
	Component: ComponentType<TProps>,
): ComponentType<TProps> {
	return Object.assign(
		(props: TProps) => (
			<RepositoryQueriesBoundary queries={queries} component={Component} componentProps={props} />
		),
		{ displayName: `WithRepositoryQueries(${Component.displayName ?? Component.name})` },
	);
}

function RepositoryQueriesBoundary<TProps extends object>({
	queries,
	component: Component,
	componentProps,
}: {
	readonly queries: QueryClient;
	readonly component: ComponentType<TProps>;
	readonly componentProps: TProps;
}) {
	return (
		<QueryClientProvider client={queries}>
			<Component {...componentProps} />
		</QueryClientProvider>
	);
}
