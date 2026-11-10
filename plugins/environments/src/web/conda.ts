import {
	mutationOptions,
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
	type QueryClient,
	type UseMutationResult,
	type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { KernelError, type DomainObjectMethods } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";

import { Conda, type CondaStatus } from "../contracts/index";

export type CondaClient = DomainObjectMethods<typeof Conda>;
export type CondaMethod = keyof CondaClient & string;
type Input<M extends CondaMethod> = Parameters<CondaClient[M]>[0];
type Output<M extends CondaMethod> = Awaited<ReturnType<CondaClient[M]>>;

/** Every cached conda read sits under this key. */
export const CONDA_QUERY_ROOT = "environments";

const unavailable = () =>
	Promise.reject(new KernelError("UNAVAILABLE", "Conda Environments is unavailable."));

const UNAVAILABLE_CLIENT = new Proxy({} as CondaClient, { get: () => unavailable });

/** This window's `kilo.environments/conda` methods; calls fail while it is not provided. */
export function useConda(): CondaClient {
	const conda = useDomainObject(Conda);
	return useMemo(() => conda?.methods ?? UNAVAILABLE_CLIENT, [conda]);
}

/** Whether Conda Environments can be used; null until known. */
export function useCondaStatus(): CondaStatus | null {
	return useDomainObjectState(Conda, (state) => state.status) ?? null;
}

/** The cache key of a conda read: `["environments", method, input?]`. */
export function condaQueryKey<M extends CondaMethod>(
	method: M,
	input?: Input<M>,
): readonly unknown[] {
	return input === undefined ? [CONDA_QUERY_ROOT, method] : [CONDA_QUERY_ROOT, method, input];
}

/** TanStack Query options for a conda read. */
export function condaQueryOptions<M extends CondaMethod>(
	conda: CondaClient,
	method: M,
	...input: undefined extends Input<M> ? [Input<M>?] : [Input<M>]
) {
	return queryOptions({
		queryKey: condaQueryKey(method, input[0]),
		queryFn: () => (conda[method] as (input: Input<M>) => Promise<Output<M>>)(input[0] as Input<M>),
	});
}

/** Reads a conda method with TanStack Query. */
export function useCondaQuery<M extends CondaMethod>(
	conda: CondaClient,
	method: M,
	...input: undefined extends Input<M> ? [Input<M>?] : [Input<M>]
): UseQueryResult<Output<M>> {
	return useQuery(condaQueryOptions(conda, method, ...input));
}

/** Refreshes the cached reads of `methods`. */
export async function invalidateConda(
	queryClient: QueryClient,
	methods: readonly CondaMethod[],
): Promise<void> {
	for (const method of methods) {
		await queryClient.invalidateQueries({ queryKey: [CONDA_QUERY_ROOT, method] });
	}
}

/** Calls a conda write with TanStack Query, refreshing `invalidates` on success. */
export function useCondaMutation<M extends CondaMethod>(
	conda: CondaClient,
	method: M,
	config: { readonly invalidates?: readonly CondaMethod[] } = {},
): UseMutationResult<Output<M>, Error, Input<M>> {
	const queryClient = useQueryClient();
	return useMutation(
		mutationOptions({
			mutationKey: [CONDA_QUERY_ROOT, method] as const,
			mutationFn: (input: Input<M>) =>
				(conda[method] as (input: Input<M>) => Promise<Output<M>>)(input),
			onSuccess: () => invalidateConda(queryClient, config.invalidates ?? []),
		}),
	);
}
