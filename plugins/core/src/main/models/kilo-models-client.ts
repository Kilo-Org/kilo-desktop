import type { ServerConnection } from "../../contracts";

/**
 * The part of the Kilo server's API the models area uses, so tests can fake
 * it. Wire shapes keep Kilo's own names (`providerID`) and never leave this
 * area: `ai-provider-list.ts` converts them to the contract's.
 */
export interface KiloModelsClient {
	listAiProviders(): Promise<KiloProviderList>;
	readGlobalConfig(): Promise<KiloGlobalConfig>;
	/** Deep-merges `config` into the user's global config; `null` deletes. */
	updateGlobalConfig(config: KiloGlobalConfig): Promise<void>;
	setApiKey(aiProviderId: string, key: string): Promise<void>;
	removeApiKey(aiProviderId: string): Promise<void>;
	/** Disposes the server's instances so they reload AI providers and config. */
	disposeInstances(): Promise<void>;
}

export type CreateKiloModelsClient = (connection: ServerConnection) => KiloModelsClient;

/** `provider.list`, the fields read here. */
export interface KiloProviderList {
	readonly all: readonly KiloProvider[];
	readonly connected: readonly string[];
	/** Each AI provider's default model id. */
	readonly default?: Readonly<Record<string, string>>;
}

export interface KiloProvider {
	readonly id: string;
	readonly name: string;
	readonly source?: "env" | "config" | "custom" | "api";
	readonly env?: readonly string[];
	/** Present when a key is stored for it (or set in config). */
	readonly key?: string;
	readonly models: Readonly<Record<string, KiloProviderModel>>;
}

export interface KiloProviderModel {
	readonly id: string;
	readonly name: string;
	readonly providerID?: string;
	readonly variants?: Readonly<Record<string, unknown>>;
	/** Older payloads list efforts here instead of `variants`. */
	readonly reasoning_options?: ReadonlyArray<{ type?: string; values?: ReadonlyArray<string> }>;
	readonly limit?: { readonly context?: number; readonly output?: number };
	readonly capabilities?: { readonly reasoning?: boolean; readonly attachment?: boolean };
	readonly isFree?: boolean;
	readonly recommendedIndex?: number;
	readonly options?: { readonly description?: string };
	readonly cost?: { readonly output?: number };
	readonly hasUserByokAvailable?: boolean;
}

/** The user's global Kilo config, the fields read here. */
export interface KiloGlobalConfig {
	readonly provider?: Readonly<Record<string, unknown>>;
	/** `<providerID>/<modelID>`. */
	readonly model?: string;
}
