import {
	isCustomProviderPackage,
	KILO_PROVIDER_ID,
	POPULAR_PROVIDER_IDS,
	POPULAR_PROVIDER_NAMES,
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
	disabled: boolean;
	source: ProviderSource | undefined;
	custom: boolean;
	canDisconnect: boolean;
	/** Enable/disable toggle — only for Connected rows (not Popular). */
	canDisable: boolean;
	isKilo: boolean;
};

export type ProviderListView = {
	connected: ProviderRow[];
	popular: ProviderRow[];
};

function isCustom(config: GlobalProviderConfig, id: string): boolean {
	const entry = config.provider?.[id];
	return !!entry && isCustomProviderPackage(entry.npm);
}

function row(
	provider: CatalogProvider,
	connected: boolean,
	disabled: boolean,
	config: GlobalProviderConfig,
): ProviderRow {
	const kilo = provider.id === KILO_PROVIDER_ID;
	const custom = isCustom(config, provider.id);
	return {
		id: provider.id,
		name: provider.name,
		connected,
		disabled,
		source: provider.source,
		custom,
		canDisconnect: !kilo && provider.source !== "env",
		canDisable: connected && !kilo,
		isKilo: kilo,
	};
}

function resolveCatalog(
	byId: Map<string, CatalogProvider>,
	id: string,
	config: GlobalProviderConfig,
): CatalogProvider {
	const listed = byId.get(id);
	if (listed) return listed;
	const configured = config.provider?.[id];
	const configuredName =
		configured && typeof configured.name === "string" && configured.name.trim()
			? configured.name.trim()
			: undefined;
	const popularName =
		id in POPULAR_PROVIDER_NAMES
			? POPULAR_PROVIDER_NAMES[id as keyof typeof POPULAR_PROVIDER_NAMES]
			: undefined;
	return {
		id,
		name: configuredName ?? popularName ?? id,
		source: isCustom(config, id) ? "custom" : popularName ? "api" : undefined,
	};
}

function collectConnectedIds(connected: readonly string[], disabled: readonly string[]): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const id of connected) {
		if (seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	for (const id of disabled) {
		if (seen.has(id) || id === KILO_PROVIDER_ID) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

function byConnectedName(left: ProviderRow, right: ProviderRow): number {
	if (left.isKilo !== right.isKilo) return left.isKilo ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

/**
 * Connected means credentials are present. `provider.list` drops disabled
 * providers from `connected`; Settings still lists them there (`disabled`
 * is only “hidden from the model selector”).
 */
export function groupProviderList(input: {
	all: readonly CatalogProvider[];
	connected: readonly string[];
	config: GlobalProviderConfig;
}): ProviderListView {
	const byId = new Map(input.all.map((provider) => [provider.id, provider]));
	const disabledIds = new Set(input.config.disabled_providers ?? []);
	const seen = new Set(collectConnectedIds(input.connected, [...disabledIds]));

	const connected = [...seen]
		.map((id) =>
			row(resolveCatalog(byId, id, input.config), true, disabledIds.has(id), input.config),
		)
		.toSorted(byConnectedName);

	const popular: ProviderRow[] = [];
	for (const id of POPULAR_PROVIDER_IDS) {
		if (id === KILO_PROVIDER_ID) continue;
		if (seen.has(id)) continue;
		popular.push(row(resolveCatalog(byId, id, input.config), false, false, input.config));
	}

	return { connected, popular };
}
