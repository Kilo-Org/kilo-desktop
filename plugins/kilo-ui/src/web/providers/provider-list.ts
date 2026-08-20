import {
	isCustomProviderPackage,
	KILO_PROVIDER_ID,
	POPULAR_PROVIDER_IDS,
} from "./custom-provider.js";

export type ProviderSource = "env" | "api" | "config" | "custom";

export type CatalogProvider = {
	id: string;
	name: string;
	source?: ProviderSource;
	env?: string[];
};

export type GlobalProviderConfig = {
	disabled_providers?: string[];
	provider?: Record<
		string,
		{ npm?: string; name?: string; options?: unknown; models?: unknown } | null | undefined
	>;
};

export type ProviderRow = {
	id: string;
	name: string;
	connected: boolean;
	source: ProviderSource | undefined;
	custom: boolean;
	canDisconnect: boolean;
	isKilo: boolean;
};

export type ProviderListView = {
	connected: ProviderRow[];
	popular: ProviderRow[];
	disabled: ProviderRow[];
};

function isCustom(config: GlobalProviderConfig, id: string): boolean {
	const entry = config.provider?.[id];
	return !!entry && isCustomProviderPackage(entry.npm);
}

function row(
	provider: CatalogProvider,
	connected: boolean,
	config: GlobalProviderConfig,
): ProviderRow {
	const kilo = provider.id === KILO_PROVIDER_ID;
	const custom = isCustom(config, provider.id);
	return {
		id: provider.id,
		name: provider.name,
		connected,
		source: provider.source,
		custom,
		canDisconnect: !kilo && provider.source !== "env",
		isKilo: kilo,
	};
}

export function groupProviderList(input: {
	all: readonly CatalogProvider[];
	connected: readonly string[];
	config: GlobalProviderConfig;
}): ProviderListView {
	const byId = new Map(input.all.map((provider) => [provider.id, provider]));
	const connectedIds = new Set(input.connected);
	const disabledIds = new Set(input.config.disabled_providers ?? []);

	const connected: ProviderRow[] = [];
	for (const id of input.connected) {
		if (disabledIds.has(id)) continue;
		const provider = byId.get(id);
		if (!provider) continue;
		connected.push(row(provider, true, input.config));
	}
	connected.sort((left, right) => Number(right.isKilo) - Number(left.isKilo));

	const popular: ProviderRow[] = [];
	for (const id of POPULAR_PROVIDER_IDS) {
		if (id === KILO_PROVIDER_ID) continue;
		if (connectedIds.has(id) || disabledIds.has(id)) continue;
		const provider = byId.get(id);
		if (!provider) continue;
		popular.push(row(provider, false, input.config));
	}

	const disabled: ProviderRow[] = [];
	for (const id of disabledIds) {
		const provider = byId.get(id);
		if (!provider) continue;
		disabled.push(row(provider, connectedIds.has(id), input.config));
	}

	return { connected, popular, disabled };
}
