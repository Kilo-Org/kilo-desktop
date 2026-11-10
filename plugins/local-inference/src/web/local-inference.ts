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

import {
	KernelError,
	KernelFlags,
	KernelTelemetry,
	type DomainObjectHandle,
	type DomainObjectMethods,
} from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";

import {
	LocalModels,
	ModelServer,
	type LocalModelsState,
	type ModelDownload,
	type ModelServerState,
} from "../contracts/index";
import { upsertDownload } from "./catalog/catalog-downloads";

/** Both domain objects' methods as one client, so call sites stay origin's (names don't collide). */
export type LocalInferenceClient = DomainObjectMethods<typeof LocalModels> &
	DomainObjectMethods<typeof ModelServer>;
export type LocalInferenceMethod = keyof LocalInferenceClient & string;
type Input<M extends LocalInferenceMethod> = Parameters<LocalInferenceClient[M]>[0];
type Output<M extends LocalInferenceMethod> = Awaited<ReturnType<LocalInferenceClient[M]>>;

/** Every cached Local Model Server read sits under this key. */
export const LOCAL_INFERENCE_QUERY_ROOT = "local-inference";

const unavailable = () =>
	Promise.reject(new KernelError("UNAVAILABLE", "The Local Model Server is unavailable."));

type AnyHandle = { readonly methods: Record<string, (input: never) => Promise<unknown>> };

function methodsOf(
	definition: { readonly methods: object },
	handle: AnyHandle | null,
): Record<string, (input: never) => Promise<unknown>> {
	return Object.fromEntries(
		Object.keys(definition.methods).map((name) => [
			name,
			handle ? (input: never) => handle.methods[name]!(input) : unavailable,
		]),
	);
}

/** One client over both domain objects; a method fails while its object is absent. */
function localInferenceClient(
	models: DomainObjectHandle<typeof LocalModels> | null,
	server: DomainObjectHandle<typeof ModelServer> | null,
): LocalInferenceClient {
	return {
		...methodsOf(LocalModels, models as AnyHandle | null),
		...methodsOf(ModelServer, server as AnyHandle | null),
	} as unknown as LocalInferenceClient;
}

/** This window's Local Model Server methods; calls fail while it is absent. */
export function useLocalInference(): LocalInferenceClient {
	const models = useDomainObject(LocalModels);
	const server = useDomainObject(ModelServer);
	return useMemo(() => localInferenceClient(models, server), [models, server]);
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
 * objects' state, which main updates as the server, registry and downloads
 * change (origin's `status-changed` / `models-changed` /
 * `catalog-download-changed` events); a finished download reads the models
 * and status again, as origin did.
 */
export function useFollowLocalInference(): void {
	const models = useDomainObject(LocalModels);
	const server = useDomainObject(ModelServer);
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!models) return;
		let previous = models.getState().models;
		return models.subscribe((state) => {
			if (previous === state.models) return;
			previous = state.models;
			queryClient.setQueryData(localInferenceQueryKey("listModels"), state.models);
		});
	}, [models, queryClient]);
	useEffect(() => {
		if (!server) return;
		let previous: ModelServerState = server.getState();
		return server.subscribe((state) => {
			if (previous.status !== state.status) {
				queryClient.setQueryData(localInferenceQueryKey("status"), state.status);
			}
			const changed = state.downloads.filter((download) => !previous.downloads.includes(download));
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
		});
	}, [server, queryClient]);
}

/** The Local Model Server's installed models; null while they are not provided. */
export function useLocalModelsState<T>(select: (state: LocalModelsState) => T): T | null {
	return useDomainObjectState(LocalModels, select) ?? null;
}

/** The Local Model Server's state; null while it is not provided. */
export function useModelServerState<T>(
	select: (state: ModelServerState) => T,
	isEqual?: (a: T, b: T) => boolean,
): T | null {
	return useDomainObjectState(ModelServer, select, isEqual) ?? null;
}

/** Sends a declared telemetry event (a `kernel/telemetry-event` id); never fails the caller. */
export function useTrack(): (event: string, data?: Record<string, unknown>) => void {
	const telemetry = useDomainObject(KernelTelemetry);
	return useCallback(
		(event, data = {}) => void telemetry?.methods.track({ event, data }).catch(() => undefined),
		[telemetry],
	);
}

/** A declared `kernel/flag`; false until flags are known. */
export function useFlag(name: string): boolean {
	return useDomainObjectState(KernelFlags, (state) => state.flags[name]?.value === true) ?? false;
}

/** The local path of a picked or dropped file; null where the window can't tell. */
export function usePathForFile(): (file: File) => string | null {
	const kernel = useKernel();
	return useCallback((file: File) => kernel.pathForFile(file), [kernel]);
}
