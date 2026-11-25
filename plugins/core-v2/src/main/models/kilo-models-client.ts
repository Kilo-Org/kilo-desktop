import type { IntegrationInfo, ModelInfo, ProviderInfo } from "@kilocode/client";

import type { ServerConnection } from "../../contracts";

/**
 * The part of the Kilo server's API the models area uses, so tests can fake
 * it. Kilo's own shapes never leave this area: `ai-provider-list.ts` maps
 * them to the contract's.
 */
export interface KiloModelsClient {
	listAiProviders(): Promise<KiloProviderAnswers>;
	/** The user's global Kilo settings (Desktop's global config document). */
	readSettings(): Promise<KiloSettings>;
	/** Deep-merges `set` into the user's global settings; `null` deletes. */
	updateSettings(set: KiloSettingsPatch): Promise<void>;
	setApiKey(aiProviderId: string, key: string): Promise<void>;
	removeApiKey(aiProviderId: string): Promise<void>;
	/** Disposes the server's instances so they reload AI providers and config. */
	disposeInstances(): Promise<void>;
}

export type CreateKiloModelsClient = (connection: ServerConnection) => KiloModelsClient;

/** Kilo's answers about AI providers, in its global directory's location. */
export interface KiloProviderAnswers {
	/** Every AI provider (and MCP server) Kilo knows, and how each is connected. */
	readonly integrations: readonly IntegrationInfo[];
	/** The usable (connected) AI providers. */
	readonly providers: readonly ProviderInfo[];
	readonly models: readonly ModelInfo[];
	/** One default model for the whole location. */
	readonly defaultModel: ModelInfo | null;
}

/** The user's global Kilo settings, the keys read here. */
export interface KiloSettings {
	readonly providers?: Readonly<Record<string, unknown>>;
	/** `<providerID>/<model>[#<variant>]` or `{ providerID, model }`. */
	readonly model?: unknown;
}

export interface KiloSettingsPatch {
	/** Entries are JSON; `null` deletes. */
	readonly providers?: Readonly<Record<string, unknown>>;
	readonly model?: string | null;
}
