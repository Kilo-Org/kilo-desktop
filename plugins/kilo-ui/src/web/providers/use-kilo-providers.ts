import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../chat/runtime/create-kilo-runtime-client.js";
import type { CatalogProvider, GlobalProviderConfig, ProviderListView } from "./provider-list.js";
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
	setDisabled,
	type KiloProviderClient,
} from "./provider-mutations.js";

export type ProviderManagementData = {
	view: ProviderListView;
	config: GlobalProviderConfig;
	ids: string[];
};

type ProviderListResponse = {
	all: CatalogProvider[];
	connected: string[];
};

function message(error: unknown): string | null {
	return error instanceof Error ? error.message : error ? String(error) : null;
}

export async function fetchProviderManagement(
	connection: KiloGlobalConnection | undefined,
): Promise<ProviderManagementData> {
	if (!connection) {
		throw new Error("Cannot load providers before Kilo is connected");
	}
	const client = createKiloDirectoryClient(connection, connection.globalDirectory);
	const [{ data: list }, { data: global }] = await Promise.all([
		client.provider.list({}, { throwOnError: true }),
		client.global.config.get({ throwOnError: true }),
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
		queryFn: () => fetchProviderManagement(connection),
		enabled: connection !== undefined,
		retry: false,
	});

	const run = async (task: (client: KiloProviderClient) => Promise<void>) => {
		if (!connection) throw new Error("Kilo is not connected");
		await task(asProviderClient(connection)).finally(() => {
			invalidateKiloProviderQueries(queryClient);
		});
	};

	const connect = useMutation({
		mutationFn: ({ providerID, apiKey }: { providerID: string; apiKey: string }) =>
			run((client) => connectApiKey(client, providerID, apiKey)),
	});
	const disconnect = useMutation({
		mutationFn: (providerID: string) => run((client) => disconnectProvider(client, providerID)),
	});
	const disable = useMutation({
		mutationFn: ({ providerID, disabled }: { providerID: string; disabled: boolean }) =>
			run((client) => setDisabled(client, providerID, disabled)),
	});
	const save = useMutation({
		mutationFn: (input: {
			providerID: string;
			provider: unknown;
			apiKey: string | undefined;
			apiKeyChanged: boolean;
		}) =>
			run((client) =>
				saveCustom(client, input.providerID, input.provider, input.apiKey, input.apiKeyChanged),
			),
	});
	const remove = useMutation({
		mutationFn: (providerID: string) => run((client) => deleteCustom(client, providerID)),
	});

	const error =
		connect.error ?? disconnect.error ?? disable.error ?? save.error ?? remove.error ?? query.error;

	const pending =
		connect.isPending ||
		disconnect.isPending ||
		disable.isPending ||
		save.isPending ||
		remove.isPending;

	return useMemo(
		() => ({
			view: query.data?.view,
			config: query.data?.config,
			ids: query.data?.ids ?? [],
			isLoading: query.isPending,
			isError: query.isError,
			error: message(error),
			connectError: message(connect.error),
			saveError: message(save.error),
			pending,
			reload: query.refetch,
			resetConnect: connect.reset,
			resetSave: save.reset,
			connect: connect.mutateAsync,
			disconnect: disconnect.mutateAsync,
			setDisabled: disable.mutateAsync,
			saveCustom: save.mutateAsync,
			deleteCustom: remove.mutateAsync,
		}),
		[
			connect.mutateAsync,
			connect.reset,
			disconnect.mutateAsync,
			disable.mutateAsync,
			save.mutateAsync,
			save.reset,
			remove.mutateAsync,
			error,
			pending,
			query.data?.config,
			query.data?.ids,
			query.data?.view,
			query.isError,
			query.isPending,
			query.refetch,
		],
	);
}
