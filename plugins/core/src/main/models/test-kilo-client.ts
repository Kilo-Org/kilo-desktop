import type { KiloGlobalConfig, KiloModelsClient, KiloProviderList } from "./kilo-models-client";

export interface FakeKiloClient {
	readonly client: KiloModelsClient;
	readonly calls: {
		readonly set: { aiProviderId: string; key: string }[];
		readonly remove: string[];
		readonly update: KiloGlobalConfig[];
		readonly order: string[];
		dispose: number;
		list: number;
	};
	/** What `provider.list` returns next. */
	list: KiloProviderList;
	config: KiloGlobalConfig;
	/** While set, `provider.list` fails with it. */
	listError?: Error;
	/** While set, `provider.list` waits for it. */
	listGate?: Promise<void>;
}

/** A Kilo server's model API in memory: `global.config.update` merges entries one level deep. */
export function createFakeKiloClient(
	initial: { list?: KiloProviderList; config?: KiloGlobalConfig } = {},
): FakeKiloClient {
	const fake: FakeKiloClient = {
		calls: { set: [], remove: [], update: [], order: [], dispose: 0, list: 0 },
		list: initial.list ?? { all: [], connected: [] },
		config: structuredClone(initial.config ?? {}),
		client: {
			listAiProviders: async () => {
				fake.calls.list += 1;
				await fake.listGate;
				if (fake.listError) throw fake.listError;
				return fake.list;
			},
			readGlobalConfig: async () => fake.config,
			updateGlobalConfig: async (config) => {
				fake.calls.update.push(config);
				fake.calls.order.push("update");
				const provider: Record<string, unknown> = { ...fake.config.provider };
				for (const [id, entry] of Object.entries(config.provider ?? {})) {
					if (entry === null) delete provider[id];
					else provider[id] = entry;
				}
				fake.config = { ...fake.config, provider };
			},
			setApiKey: async (aiProviderId, key) => {
				fake.calls.set.push({ aiProviderId, key });
				fake.calls.order.push("set");
			},
			removeApiKey: async (aiProviderId) => {
				fake.calls.remove.push(aiProviderId);
				fake.calls.order.push("remove");
			},
			disposeInstances: async () => {
				fake.calls.dispose += 1;
			},
		},
	};
	return fake;
}
