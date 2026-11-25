import type { IntegrationInfo, ModelInfo, ProviderInfo } from "@kilocode/client";

import type {
	KiloModelsClient,
	KiloProviderAnswers,
	KiloSettings,
	KiloSettingsPatch,
} from "./kilo-models-client";

export interface FakeKiloClient {
	readonly client: KiloModelsClient;
	readonly calls: {
		readonly set: { aiProviderId: string; key: string }[];
		readonly remove: string[];
		readonly update: KiloSettingsPatch[];
		readonly order: string[];
		dispose: number;
		list: number;
	};
	/** What the provider lists answer next. */
	list: KiloProviderAnswers;
	config: KiloSettings;
	/** While set, the provider lists fail with it. */
	listError?: Error;
	/** While set, the provider lists wait for it. */
	listGate?: Promise<void>;
}

export const NO_AI_PROVIDERS: KiloProviderAnswers = {
	integrations: [],
	providers: [],
	models: [],
	defaultModel: null,
};

/** A Kilo server's model API in memory: a settings write merges providers one level deep. */
export function createFakeKiloClient(
	initial: { list?: KiloProviderAnswers; config?: KiloSettings } = {},
): FakeKiloClient {
	const fake: FakeKiloClient = {
		calls: { set: [], remove: [], update: [], order: [], dispose: 0, list: 0 },
		list: initial.list ?? NO_AI_PROVIDERS,
		config: structuredClone(initial.config ?? {}),
		client: {
			listAiProviders: async () => {
				fake.calls.list += 1;
				await fake.listGate;
				if (fake.listError) throw fake.listError;
				return fake.list;
			},
			readSettings: async () => fake.config,
			updateSettings: async (set) => {
				fake.calls.update.push(set);
				fake.calls.order.push("update");
				const providers: Record<string, unknown> = { ...fake.config.providers };
				for (const [id, entry] of Object.entries(set.providers ?? {})) {
					if (entry === null) delete providers[id];
					else providers[id] = entry;
				}
				fake.config = { ...fake.config, providers };
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

/** An AI provider Kilo knows, with the env names it reads and how it is connected. */
export function integration(
	id: string,
	fields: {
		readonly name?: string;
		readonly env?: readonly string[];
		readonly connections?: readonly ("key" | "oauth" | "env")[];
		readonly mcp?: boolean;
	} = {},
): IntegrationInfo {
	return {
		id,
		name: fields.name ?? id,
		...(fields.mcp ? { metadata: { source: "mcp" } } : {}),
		methods: fields.env ? [{ type: "env", names: [...fields.env] }] : [],
		connections: (fields.connections ?? []).map((how) =>
			how === "env" ? { type: "env" } : { type: "credential", method: how },
		),
	} as unknown as IntegrationInfo;
}

/** A usable (connected) AI provider. */
export function usableProvider(id: string, name = id): ProviderInfo {
	return { id, name, integrationID: id } as unknown as ProviderInfo;
}

/** An enabled model of `providerID`. */
export function kiloModel(
	providerID: string,
	id: string,
	fields: {
		readonly name?: string;
		readonly enabled?: boolean;
		readonly variants?: readonly string[];
		readonly context?: number;
		readonly output?: number;
		readonly images?: boolean;
		readonly cost?: readonly { readonly input: number; readonly output: number }[];
	} = {},
): ModelInfo {
	return {
		id,
		providerID,
		name: fields.name ?? id,
		enabled: fields.enabled ?? true,
		variants: (fields.variants ?? []).map((variant) => ({ id: variant })),
		limit: { context: fields.context ?? 0, output: fields.output ?? 0 },
		capabilities: { input: fields.images ? ["text", "image"] : ["text"], output: ["text"] },
		cost: fields.cost ?? [],
	} as unknown as ModelInfo;
}

/** Kilo's answers for AI providers it knows, connected unless they say otherwise. */
export function providerAnswers(
	providers: readonly {
		readonly id: string;
		readonly name?: string;
		readonly connections?: readonly ("key" | "oauth" | "env")[];
		readonly models?: readonly ModelInfo[];
		readonly connected?: boolean;
	}[],
): KiloProviderAnswers {
	const connected = providers.filter((provider) => provider.connected !== false);
	return {
		integrations: providers.map(({ id, name, connections }) =>
			integration(id, { ...(name ? { name } : {}), ...(connections ? { connections } : {}) }),
		),
		providers: connected.map(({ id, name }) => usableProvider(id, name)),
		models: providers.flatMap((provider) => provider.models ?? []),
		defaultModel: null,
	};
}
