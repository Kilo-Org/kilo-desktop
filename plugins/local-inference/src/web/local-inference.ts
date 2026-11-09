import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
	type QueryClient,
	type UseMutationResult,
	type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import { KernelError, type DomainMethods } from "@kilo-desktop/kernel";
import { useDomain, useDomainState, useKernel } from "@kilo-desktop/kernel/web";
import { Flags } from "@kilo-desktop/plugin-flags/contracts";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";

import {
	LocalInference,
	type LocalInferenceState,
	type ModelDownload,
} from "../contracts/index.js";
import { upsertDownload } from "./catalog/catalog-downloads.js";

export type LocalInferenceClient = DomainMethods<typeof LocalInference>;
export type LocalInferenceMethod = keyof LocalInferenceClient & string;
type Input<M extends LocalInferenceMethod> = Parameters<LocalInferenceClient[M]>[0];
type Output<M extends LocalInferenceMethod> = Awaited<ReturnType<LocalInferenceClient[M]>>;

/** Every cached Local Model Server read sits under this key. */
export const LOCAL_INFERENCE_QUERY_ROOT = "local-inference";

const unavailable = () =>
	Promise.reject(new KernelError("UNAVAILABLE", "The Local Model Server is unavailable."));

const UNAVAILABLE_CLIENT = new Proxy({} as LocalInferenceClient, { get: () => unavailable });

/** This window's `kilo.local-inference/local-inference` methods; calls fail while it is absent. */
export function useLocalInference(): LocalInferenceClient {
	const domain = useDomain(LocalInference);
	return useMemo(() => domain?.methods ?? UNAVAILABLE_CLIENT, [domain]);
}

export function localInferenceQueryKey<M extends LocalInferenceMethod>(
	method: M,
	input?: Input<M>,
): readonly unknown[] {
	return input === undefined
		? [LOCAL_INFERENCE_QUERY_ROOT, method]
		: [LOCAL_INFERENCE_QUERY_ROOT, method, input];
}

export function localInferenceQueryOptions<M extends LocalInferenceMethod>(
	client: LocalInferenceClient,
	method: M,
) {
	return queryOptions({
		queryKey: localInferenceQueryKey(method),
		queryFn: () =>
			(client[method] as unknown as (input: undefined) => Promise<Output<M>>)(undefined),
	});
}

/** A read of a method that takes no input (origin's `useSdkQuery`). */
export function useLocalInferenceQuery<M extends LocalInferenceMethod>(
	method: M,
): UseQueryResult<Output<M>, Error> {
	return useQuery(localInferenceQueryOptions(useLocalInference(), method));
}

function invalidate(queryClient: QueryClient, methods: readonly LocalInferenceMethod[]) {
	for (const method of methods) {
		void queryClient.invalidateQueries({ queryKey: localInferenceQueryKey(method) });
	}
}

/** A call that refreshes the listed reads when it settles (origin's `useSdkMutation`). */
export function useLocalInferenceMutation<M extends LocalInferenceMethod>(
	method: M,
	options: { readonly invalidates?: readonly LocalInferenceMethod[] } = {},
): UseMutationResult<Output<M>, Error, Input<M>> {
	const client = useLocalInference();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: Input<M>) =>
			(client[method] as (input: Input<M>) => Promise<Output<M>>)(input),
		onSettled: () => invalidate(queryClient, options.invalidates ?? []),
	});
}

/**
 * Keeps the cached status, models and downloads in step with the domain
 * object's state, which main updates as the server, registry and downloads
 * change (origin's `status-changed` / `models-changed` /
 * `catalog-download-changed` events); a finished download reads the models
 * and status again, as origin did.
 */
export function useFollowLocalInference(): void {
	const domain = useDomain(LocalInference);
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!domain) return;
		let previous: LocalInferenceState | undefined;
		const follow = (state: LocalInferenceState) => {
			if (previous?.status !== state.status) {
				queryClient.setQueryData(localInferenceQueryKey("status"), state.status);
			}
			if (previous?.models !== state.models) {
				queryClient.setQueryData(localInferenceQueryKey("listModels"), state.models);
			}
			const before = previous?.downloads ?? [];
			const changed = state.downloads.filter((download) => !before.includes(download));
			for (const download of changed) {
				queryClient.setQueryData<ModelDownload[]>(
					localInferenceQueryKey("listDownloads"),
					(current) => upsertDownload(current, download),
				);
			}
			if (changed.some((download) => download.status === "completed")) {
				invalidate(queryClient, ["listModels", "status"]);
			}
			previous = state;
		};
		previous = domain.getState();
		return domain.subscribe(follow);
	}, [domain, queryClient]);
}

/** The Local Model Server's state; null while it is not provided. */
export function useLocalInferenceState<T>(select: (state: LocalInferenceState) => T): T | null {
	return useDomainState(LocalInference, select) ?? null;
}

/** Sends a declared telemetry event; never fails the caller. */
export function useTrack(): (event: string, data?: Record<string, unknown>) => void {
	const telemetry = useDomain(Telemetry);
	return useCallback(
		(event, data = {}) => void telemetry?.methods.track({ event, data }).catch(() => undefined),
		[telemetry],
	);
}

/** A kilo.flags flag; false while flags are not provided. */
export function useFlag(name: string): boolean {
	return useDomainState(Flags, (state) => state.flags[name] === true) ?? false;
}

/** The local path of a picked or dropped file; null where the window can't tell. */
export function usePathForFile(): (file: File) => string | null {
	const kernel = useKernel();
	return useCallback((file: File) => kernel.pathForFile(file), [kernel]);
}
