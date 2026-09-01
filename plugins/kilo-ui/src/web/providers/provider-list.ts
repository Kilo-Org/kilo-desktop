import {
	isCustomProviderPackage,
	POPULAR_PROVIDER_IDS,
	POPULAR_PROVIDER_NAMES,
} from "./custom-provider.js";
import { ANACONDA_LOCAL_PROVIDER_ID, KILO_PROVIDER_ID } from "./provider-ids.js";

export type ProviderSource = "env" | "api" | "config" | "custom";

export type CatalogProvider = {
	id: string;
	name: string;
	source?: ProviderSource;
	env?: string[];
};

export type GlobalProviderConfig = {
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
	isLocal: boolean;
	managed: boolean;
	env: readonly string[];
};

export type ProviderListView = {
	connected: ProviderRow[];
	environment: ProviderRow[];
	popular: ProviderRow[];
};

function isCustom(config: GlobalProviderConfig, id: string): boolean {
	const entry = config.provider?.[id];
	return !!entry && isCustomProviderPackage(entry.npm);
}

/**
 * Kilo autoloads some catalog providers (notably Amazon Bedrock via
 * AWS_PROFILE / the credential chain) with source "custom" or "config"
 * even when the user never stored an API key. Those are not disconnectable
 * through auth.remove — they come back on the next provider.list.
 */
export function isEnvironmentSourced(
	row: Pick<ProviderRow, "custom" | "managed" | "source">,
): boolean {
	if (row.managed || row.custom) return false;
	return row.source === "env" || row.source === "custom" || row.source === "config";
}

export function providerSourceLabel(row: Pick<ProviderRow, "custom" | "source">): string {
	if (row.source === "env") return "Environment Variables";
	if (row.custom) return "Custom";
	if (row.source === "api") return "API key";
	return "System credentials";
}

function relatedEnv(provider: CatalogProvider): readonly string[] {
	const env = [...(provider.env ?? [])];
	if (provider.id !== "amazon-bedrock") return env;
	for (const name of ["AWS_PROFILE", "AWS_SSO_START_URL"]) {
		if (!env.includes(name)) env.push(name);
	}
	return env;
}

function row(
	provider: CatalogProvider,
	connected: boolean,
	config: GlobalProviderConfig,
): ProviderRow {
	const kilo = provider.id === KILO_PROVIDER_ID;
	const local = provider.id === ANACONDA_LOCAL_PROVIDER_ID;
	const managed = kilo || local;
	const custom = !managed && isCustom(config, provider.id);
	return {
		id: provider.id,
		name: provider.name,
		connected,
		source: provider.source,
		custom,
		canDisconnect: !managed && (custom || provider.source === "api"),
		isKilo: kilo,
		isLocal: local,
		managed,
		env: relatedEnv(provider),
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
	const name = configuredName ?? popularName ?? id;
	if (isCustom(config, id)) return { id, name, source: "custom" };
	if (popularName) return { id, name, source: "api" };
	return { id, name };
}

function byConnectedName(left: ProviderRow, right: ProviderRow): number {
	if (left.isKilo !== right.isKilo) return left.isKilo ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

/**
 * Connected means a stored API key or a user-defined custom endpoint.
 * Environment / credential-chain rows go in `environment` instead.
 */
export function groupProviderList(input: {
	all: readonly CatalogProvider[];
	connected: readonly string[];
	config: GlobalProviderConfig;
}): ProviderListView {
	const byId = new Map(input.all.map((provider) => [provider.id, provider]));
	const seen = new Set(input.connected.filter((id) => id !== ANACONDA_LOCAL_PROVIDER_ID));

	const rows = [...seen].map((id) =>
		row(resolveCatalog(byId, id, input.config), true, input.config),
	);
	const connected = rows.filter((item) => !isEnvironmentSourced(item)).toSorted(byConnectedName);
	const environment = rows.filter((item) => isEnvironmentSourced(item)).toSorted(byConnectedName);

	const popular: ProviderRow[] = [];
	for (const id of POPULAR_PROVIDER_IDS) {
		if (id === KILO_PROVIDER_ID) continue;
		if (seen.has(id)) continue;
		popular.push(row(resolveCatalog(byId, id, input.config), false, input.config));
	}

	return { connected, environment, popular };
}
