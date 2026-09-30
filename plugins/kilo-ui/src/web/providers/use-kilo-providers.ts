import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import {
	isStaleKiloConnectionError,
	shouldRetryStaleKiloQuery,
	STALE_KILO_QUERY_RETRY_DELAY_MS,
} from "../chat/kilo-connection-error.js";
import { createKiloDirectoryClient } from "../chat/runtime/create-kilo-runtime-client.js";
import { POPULAR_PROVIDER_IDS, sanitizeCustomProviderConfig } from "./custom-provider.js";
import type {
	CatalogProvider,
	GlobalProviderConfig,
	ProviderListView,
	ProviderRow,
} from "./provider-list.js";
import { groupProviderList } from "./provider-list.js";
import {
	invalidateKiloProviderQueries,
	KILO_PROVIDERS_MANAGE_QUERY_KEY,
} from "./provider-queries.js";
import {
	connectApiKey,
	deleteCustom,
	disconnectProvider,
	saveCustom,
	type KiloProviderClient,
} from "./provider-mutations.js";

const PROVIDER_MANAGEMENT_TIMEOUT_MS = 15_000;

function boundedSignal(querySignal: AbortSignal): AbortSignal {
	return AbortSignal.any([querySignal, AbortSignal.timeout(PROVIDER_MANAGEMENT_TIMEOUT_MS)]);
}

function isTimeoutError(error: unknown): boolean {
	return error instanceof Error && error.name === "TimeoutError";
}

/**
 * The first `/provider` for a directory waits on Kilo's instance bootstrap, which
 * can outlast the request bound on a cold, busy machine. Aborting the request
 * does not stop the bootstrap, so one more attempt normally lands on a warm
 * instance instead of showing the user an error.
 */
function shouldRetryProviderManagement(failureCount: number, error: unknown): boolean {
	if (isTimeoutError(error)) return failureCount < 1;
	return shouldRetryStaleKiloQuery(failureCount, error);
}

export type ProviderManagementData = {
	view: ProviderListView;
	config: GlobalProviderConfig;
	ids: string[];
};

type ProviderListResponse = {
	all: CatalogProvider[];
	connected: string[];
};

type SaveCustomInput = {
	providerID: string;
	provider: unknown;
	apiKey: string | undefined;
	apiKeyChanged: boolean;
};

function message(error: unknown): string | null {
	return error instanceof Error ? error.message : error ? String(error) : null;
}

function byConnectedName(
	left: ProviderListView["connected"][number],
	right: ProviderListView["connected"][number],
) {
	if (left.isKilo !== right.isKilo) return left.isKilo ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function withConnectedProvider(
	current: ProviderManagementData,
	providerID: string,
): ProviderManagementData {
	const provider = current.view.popular.find((row) => row.id === providerID);
	if (!provider) return current;
	const connectedProvider: ProviderRow = {
		...provider,
		connected: true,
		source: "api",
		canDisconnect: true,
	};
	return {
		...current,
		view: {
			...current.view,
			connected: [
				...current.view.connected.filter((row) => row.id !== providerID),
				connectedProvider,
			].toSorted(byConnectedName),
			popular: current.view.popular.filter((row) => row.id !== providerID),
		},
	};
}

function withDisconnectedProvider(
	current: ProviderManagementData,
	providerID: string,
): ProviderManagementData {
	const provider = [...current.view.connected, ...current.view.environment].find(
		(row) => row.id === providerID,
	);
	const popular = current.view.popular.filter((row) => row.id !== providerID);
	if (provider && POPULAR_PROVIDER_IDS.some((id) => id === providerID)) {
		popular.push({
			...provider,
			connected: false,
		});
		popular.sort(
			(left, right) =>
				POPULAR_PROVIDER_IDS.findIndex((id) => id === left.id) -
				POPULAR_PROVIDER_IDS.findIndex((id) => id === right.id),
		);
	}
	return {
		...current,
		view: {
			connected: current.view.connected.filter((row) => row.id !== providerID),
			environment: current.view.environment.filter((row) => row.id !== providerID),
			popular,
		},
	};
}

function withoutCustomProvider(
	current: ProviderManagementData,
	providerID: string,
): ProviderManagementData {
	const configuredProviders = Object.fromEntries(
		Object.entries(current.config.provider ?? {}).filter(([id]) => id !== providerID),
	);
	return {
		...current,
		config: {
			...current.config,
			provider: configuredProviders,
		},
		ids: current.ids.filter((id) => id !== providerID),
		view: {
			connected: current.view.connected.filter((row) => row.id !== providerID),
			environment: current.view.environment.filter((row) => row.id !== providerID),
			popular: current.view.popular.filter((row) => row.id !== providerID),
		},
	};
}

function withSavedCustomProvider(
	current: ProviderManagementData,
	input: SaveCustomInput,
): ProviderManagementData {
	const sanitized = sanitizeCustomProviderConfig(input.provider);
	if ("error" in sanitized) return current;
	const provider = sanitized.value;
	const row = {
		id: input.providerID,
		name: provider.name,
		connected: true,
		source: "custom" as const,
		custom: true,
		canDisconnect: true,
		isKilo: false,
		isLocal: false,
		managed: false,
		env: [],
	};
	return {
		...current,
		config: {
			...current.config,
			provider: { ...current.config.provider, [input.providerID]: provider },
		},
		ids: current.ids.includes(input.providerID) ? current.ids : [...current.ids, input.providerID],
		view: {
			connected: [
				...current.view.connected.filter((item) => item.id !== input.providerID),
				row,
			].toSorted(byConnectedName),
			environment: current.view.environment.filter((item) => item.id !== input.providerID),
			popular: current.view.popular.filter((item) => item.id !== input.providerID),
		},
	};
}

export async function fetchProviderManagement(
	connection: KiloGlobalConnection | undefined,
	signal: AbortSignal = AbortSignal.timeout(PROVIDER_MANAGEMENT_TIMEOUT_MS),
): Promise<ProviderManagementData> {
	if (!connection) {
		throw new Error("Cannot load providers before the provider service is connected");
	}
	const client = createKiloDirectoryClient(connection, connection.globalDirectory);
	const [{ data: list }, { data: global }] = await Promise.all([
		client.provider.list({}, { throwOnError: true, signal }),
		client.global.config.get({ throwOnError: true, signal }),
	]);
	const payload = list as ProviderListResponse;
	const config = (global ?? {}) as GlobalProviderConfig;
	return {
		view: groupProviderList({
			all: payload.all ?? [],
			connected: payload.connected ?? [],
			config,
		}),
		config,
		ids: payload.all?.map((provider) => provider.id) ?? [],
	};
}

function asProviderClient(connection: KiloGlobalConnection): KiloProviderClient {
	return createKiloDirectoryClient(
		connection,
		connection.globalDirectory,
	) as unknown as KiloProviderClient;
}

export function useKiloProviders(connection: KiloGlobalConnection | undefined) {
	const queryClient = useQueryClient();
	const queryKey = [...KILO_PROVIDERS_MANAGE_QUERY_KEY, connection?.baseUrl, connection?.version];
	const query = useQuery({
		queryKey,
		queryFn: ({ signal }) => fetchProviderManagement(connection, boundedSignal(signal)),
		enabled: connection !== undefined,
		placeholderData: keepPreviousData,
		retry: shouldRetryProviderManagement,
		retryDelay: STALE_KILO_QUERY_RETRY_DELAY_MS,
	});
	const queryIdentity = `${connection?.baseUrl ?? ""}\0${connection?.version ?? ""}`;
	const [heldQueryError, setHeldQueryError] = useState<
		{ readonly queryIdentity: string; readonly error: unknown } | undefined
	>(undefined);
	useEffect(() => {
		if (!query.error) {
			if (query.data !== undefined) setHeldQueryError(undefined);
			return;
		}
		if (query.data !== undefined && isStaleKiloConnectionError(query.error)) return;
		setHeldQueryError({ queryIdentity, error: query.error });
	}, [query.data, query.error, queryIdentity]);

	const queryError =
		heldQueryError?.queryIdentity === queryIdentity ? heldQueryError.error : undefined;

	const run = async (task: (client: KiloProviderClient) => Promise<void>) => {
		if (!connection) throw new Error("The provider service is not connected");
		await task(asProviderClient(connection));
	};
	const updateCache = async (
		update: (current: ProviderManagementData) => ProviderManagementData,
	) => {
		await queryClient.cancelQueries({ queryKey });
		const previous = queryClient.getQueryData<ProviderManagementData>(queryKey);
		queryClient.setQueryData<ProviderManagementData>(queryKey, (current) =>
			current ? update(current) : current,
		);
		return { previous };
	};
	const restoreCache = (context: { previous: ProviderManagementData | undefined } | undefined) => {
		if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
	};
	const reconcile = () => invalidateKiloProviderQueries(queryClient);

	const connect = useMutation({
		mutationFn: ({ providerID, apiKey }: { providerID: string; apiKey: string }) =>
			run((client) => connectApiKey(client, providerID, apiKey)),
		onMutate: (input) => updateCache((current) => withConnectedProvider(current, input.providerID)),
		onError: (_error, _input, context) => restoreCache(context),
		onSuccess: () => resetErrors(),
		onSettled: reconcile,
	});
	const disconnect = useMutation({
		mutationFn: (providerID: string) => run((client) => disconnectProvider(client, providerID)),
		onMutate: (providerID) =>
			updateCache((current) => withDisconnectedProvider(current, providerID)),
		onError: (_error, _providerID, context) => restoreCache(context),
		onSuccess: () => resetErrors(),
		onSettled: reconcile,
	});
	const save = useMutation({
		mutationFn: (input: SaveCustomInput) =>
			run((client) =>
				saveCustom(client, input.providerID, input.provider, input.apiKey, input.apiKeyChanged),
			),
		onMutate: (input) => updateCache((current) => withSavedCustomProvider(current, input)),
		onError: (_error, _input, context) => restoreCache(context),
		onSuccess: () => resetErrors(),
		onSettled: reconcile,
	});
	const remove = useMutation({
		mutationFn: (providerID: string) => run((client) => deleteCustom(client, providerID)),
		onMutate: (providerID) => updateCache((current) => withoutCustomProvider(current, providerID)),
		onError: (_error, _providerID, context) => restoreCache(context),
		onSuccess: () => resetErrors(),
		onSettled: reconcile,
	});

	const resetErrors = () => {
		setHeldQueryError(undefined);
		connect.reset();
		disconnect.reset();
		save.reset();
		remove.reset();
	};

	const error = connect.error ?? disconnect.error ?? save.error ?? remove.error ?? queryError;

	const pending = connect.isPending || disconnect.isPending || save.isPending || remove.isPending;

	return useMemo(
		() => ({
			view: query.data?.view,
			config: query.data?.config,
			ids: query.data?.ids ?? [],
			isLoading: query.isPending && !query.isPlaceholderData,
			isError: Boolean(queryError) && query.data === undefined,
			error: message(error),
			connectError: message(connect.error),
			saveError: message(save.error),
			pending,
			reload: query.refetch,
			dismissError: resetErrors,
			resetConnect: connect.reset,
			resetSave: save.reset,
			connect: connect.mutateAsync,
			disconnect: disconnect.mutateAsync,
			saveCustom: save.mutateAsync,
			deleteCustom: remove.mutateAsync,
		}),
		[
			connect.mutateAsync,
			connect.reset,
			disconnect.mutateAsync,
			save.mutateAsync,
			save.reset,
			remove.mutateAsync,
			error,
			pending,
			query.data?.config,
			query.data?.ids,
			query.data?.view,
			queryError,
			query.data,
			query.isPending,
			query.isPlaceholderData,
			query.refetch,
		],
	);
}
