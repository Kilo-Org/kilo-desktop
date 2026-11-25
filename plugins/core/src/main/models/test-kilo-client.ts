import type {
	KiloCatalog,
	KiloGlobalConfig,
	KiloIntegration,
	KiloModel,
	KiloModelsClient,
	KiloProvider,
} from "./kilo-models-client";

export interface FakeKiloClient {
	readonly client: KiloModelsClient;
	readonly calls: {
		readonly set: { aiProviderId: string; key: string }[];
		readonly remove: string[];
		readonly update: Readonly<Record<string, unknown>>[];
		readonly order: string[];
		reload: number;
		list: number;
	};
	/** What `readCatalog` returns next. */
	catalog: KiloCatalog;
	config: KiloGlobalConfig;
	/** While set, `readCatalog` fails with it. */
	listError?: Error;
	/** While set, `readCatalog` waits for it. */
	listGate?: Promise<void>;
	/** Announces a catalog change to every watcher, as Kilo's event stream would. */
	announce(): void;
}

export const EMPTY_CATALOG: KiloCatalog = {
	providers: [],
	models: [],
	integrations: [],
	defaultModel: null,
	gateway: [],
};

/** A connected AI provider with its integration, as Kilo v2 lists them. */
export function provider(id: string, patch: Partial<KiloProvider> = {}): KiloProvider {
	return { id, name: id, activation: "enabled", integrationID: id, ...patch };
}

export function model(providerID: string, id: string, patch: Partial<KiloModel> = {}): KiloModel {
	return {
		id,
		providerID,
		name: id,
		capabilities: { tools: true, input: ["text"], output: ["text"] },
		enabled: true,
		limit: { context: 0, output: 0 },
		variants: [],
		cost: [],
		...patch,
	};
}

export function integration(id: string, patch: Partial<KiloIntegration> = {}): KiloIntegration {
	return { id, name: id, methods: [{ type: "key" }], connections: [], ...patch };
}

/** Merges a `kilocode.settings` leaf write: objects merge, `null` deletes, other values replace. */
function applySet(target: Record<string, unknown>, set: Readonly<Record<string, unknown>>) {
	const next: Record<string, unknown> = { ...target };
	for (const [key, value] of Object.entries(set)) {
		if (value === null) delete next[key];
		else if (value && typeof value === "object" && !Array.isArray(value)) {
			const existing = next[key];
			next[key] = applySet(
				existing && typeof existing === "object" && !Array.isArray(existing)
					? (existing as Record<string, unknown>)
					: {},
				value as Record<string, unknown>,
			);
		} else next[key] = value;
	}
	return next;
}

/** A Kilo v2 server's model API in memory. */
export function createFakeKiloClient(
	initial: { catalog?: Partial<KiloCatalog>; config?: KiloGlobalConfig } = {},
): FakeKiloClient {
	const watchers = new Set<() => void>();
	const fake: FakeKiloClient = {
		calls: { set: [], remove: [], update: [], order: [], reload: 0, list: 0 },
		catalog: { ...EMPTY_CATALOG, ...initial.catalog },
		config: structuredClone(initial.config ?? {}),
		announce: () => {
			for (const watcher of watchers) watcher();
		},
		client: {
			readCatalog: async () => {
				fake.calls.list += 1;
				await fake.listGate;
				if (fake.listError) throw fake.listError;
				return fake.catalog;
			},
			readGlobalConfig: async () => fake.config,
			updateGlobalConfig: async (set) => {
				fake.calls.update.push(set);
				fake.calls.order.push("update");
				fake.config = applySet(fake.config as Record<string, unknown>, set) as KiloGlobalConfig;
			},
			setApiKey: async (aiProviderId, key) => {
				fake.calls.set.push({ aiProviderId, key });
				fake.calls.order.push("set");
			},
			removeApiKey: async (aiProviderId) => {
				fake.calls.remove.push(aiProviderId);
				fake.calls.order.push("remove");
			},
			reload: async () => {
				fake.calls.reload += 1;
				fake.calls.order.push("reload");
			},
			watchCatalog: (onChange, signal) =>
				new Promise<void>((resolve) => {
					watchers.add(onChange);
					signal.addEventListener("abort", () => {
						watchers.delete(onChange);
						resolve();
					});
				}),
		},
	};
	return fake;
}
