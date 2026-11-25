import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	defineObjectType,
	implementation,
	method,
} from "@kilo-desktop/kernel";

const nothing = z.undefined();

/** The AI provider of Kilo's own gateway. */
export const KILO_AI_PROVIDER_ID = "kilo";

export const aiProviderIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);

/** One model of one AI provider, the shape every plugin passes around. */
export const modelRefSchema = z.object({
	aiProviderId: z.string().min(1),
	modelId: z.string().min(1),
});
export type ModelRef = z.output<typeof modelRefSchema>;

/** The `kilo.core/models` key of a model. */
export function modelKey(model: ModelRef): string {
	return `${model.aiProviderId}/${model.modelId}`;
}

/** One model an AI provider offers, resolved by `kilo.core/models`. */
export const Model = defineObjectType({
	id: "kilo.core/model",
	description: "A model of an AI provider, keyed `<aiProviderId>/<modelId>`.",
});

export const AI_PROVIDER_SOURCES = ["kilo", "env", "api", "config", "custom", "plugin"] as const;

export const aiProviderSchema = z.object({
	id: z.string(),
	name: z.string(),
	/** Usable now: signed in, keyed, or configured. */
	connected: z.boolean(),
	/**
	 * Where it comes from: Kilo's gateway, an environment variable, a stored
	 * API key, Kilo's config, a custom (OpenAI-compatible) provider the user
	 * added, or a plugin's `kilo.core/ai-provider` contribution.
	 */
	source: z.enum(AI_PROVIDER_SOURCES).optional(),
	/** Environment variables that configure it. */
	env: z.array(z.string()),
	/** The user can disconnect it from the app (it isn't environment-sourced or plugin-managed). */
	canDisconnect: z.boolean(),
});
export type AiProvider = z.output<typeof aiProviderSchema>;

export const modelSchema = modelRefSchema.extend({
	name: z.string(),
	/** Reasoning efforts it accepts, empty when it has none. */
	variants: z.array(z.string()),
	contextWindow: z.number().int().positive().optional(),
	maxOutputTokens: z.number().int().positive().optional(),
	/** Accepts images and files besides text. */
	attachments: z.boolean(),
	reasoning: z.boolean(),
	free: z.boolean(),
	/** Where the AI provider ranks it among its recommended models (lower first). */
	recommendedIndex: z.number().int().nonnegative().optional(),
	/** A line about it, from the AI provider. */
	description: z.string().optional(),
	/** USD per million output tokens, for a cost hint. */
	outputPricePerMillion: z.number().nonnegative().optional(),
	/** A Kilo Gateway model that can use one of the user's (or organisation's) own keys. */
	byok: z.boolean().default(false),
});
export type ModelInfo = z.output<typeof modelSchema>;

/** How many recently used models are remembered. */
export const RECENT_MODELS_LIMIT = 5;

export const modelPreferencesSchema = z.object({
	/** The model last picked for a new chat with each agent. */
	byAgent: z.record(z.string(), modelRefSchema),
	/** The model and effort last picked for a new chat with any agent; new chats start with it. */
	preferred: modelRefSchema.extend({ variant: z.string() }).optional(),
	/** Effort by `<agent>/<aiProviderId>/<modelId>`. */
	variants: z.record(z.string(), z.string()),
	recent: z.array(modelRefSchema).max(RECENT_MODELS_LIMIT),
	favorites: z.array(modelRefSchema),
	/** Opt-out for free (no-sign-in) models. */
	autoFreeModels: z.boolean(),
});
export type ModelPreferences = z.output<typeof modelPreferencesSchema>;

export const gatewayModelDetailsSchema = z.object({
	modelId: z.string().min(1),
	description: z.string().optional(),
	inputPricePerMillion: z.number().nonnegative().optional(),
	outputPricePerMillion: z.number().nonnegative().optional(),
	averageAttemptCostUsd: z.number().nonnegative().optional(),
	kiloBenchScore: z.number().min(0).max(1).optional(),
	codingIndex: z.number().nonnegative().optional(),
	codeModeRank: z.number().int().positive().optional(),
	enkryptRiskScore: z.number().min(0).max(100).optional(),
	contextWindow: z.number().int().positive().optional(),
	maxOutputTokens: z.number().int().positive().optional(),
	isFree: z.boolean().optional(),
	mayTrainOnYourPrompts: z.boolean().optional(),
	hasUserByokAvailable: z.boolean().optional(),
	modelPageSlug: z.string().min(1).optional(),
});
export type GatewayModelDetails = z.output<typeof gatewayModelDetailsSchema>;

/** The wire formats a custom AI provider's endpoint can speak. */
export const CUSTOM_AI_PROVIDER_API_FORMATS = [
	"openai-compatible",
	"openai-responses",
	"anthropic-messages",
] as const;
export type CustomAiProviderApiFormat = (typeof CUSTOM_AI_PROVIDER_API_FORMATS)[number];

export const customAiProviderSchema = z.object({
	aiProviderId: aiProviderIdSchema,
	name: z.string().trim().min(1).max(200),
	baseUrl: z.url(),
	/** Omit to keep a saved provider's format; a new one speaks `openai-compatible`. */
	apiFormat: z.enum(CUSTOM_AI_PROVIDER_API_FORMATS).optional(),
	/** Omit to keep the stored key; empty to remove it. */
	apiKey: z.string().optional(),
	headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
	models: z
		.array(
			z.object({
				modelId: z.string().trim().min(1),
				name: z.string().trim().min(1).max(200),
				reasoning: z.boolean().optional(),
				attachments: z.boolean().optional(),
				contextWindow: z.number().int().positive().optional(),
				maxOutputTokens: z.number().int().positive().optional(),
			}),
		)
		.min(1),
});
export type CustomAiProvider = z.input<typeof customAiProviderSchema>;

export const modelsStateSchema = z.object({
	/** False until the AI providers were read from the running server. */
	ready: z.boolean(),
	/**
	 * True from a change of signed-in account or organisation until the AI
	 * providers are read for it: until then (including while that read keeps
	 * failing) the lists are the previous account's, and a model picked from
	 * them may not be offered.
	 */
	followingAccount: z.boolean(),
	aiProviders: z.record(z.string(), aiProviderSchema),
	/** Models of connected AI providers, by `<aiProviderId>/<modelId>`. */
	models: z.record(z.string(), modelSchema),
	/** Each connected AI provider's default model id (Kilo's organisation default for `kilo`). */
	defaults: z.record(z.string(), z.string()),
	/** The top-level `model` of the user's Kilo config, a default before any picker choice. */
	configuredModel: modelRefSchema.optional(),
	preferences: modelPreferencesSchema,
	/** Kilo's gateway catalog (prices, benchmarks, context sizes), by model id. */
	gatewayCatalog: z.object({
		details: z.array(gatewayModelDetailsSchema),
		/** Null until it has been read. */
		fetchedAt: z.number().nullable(),
	}),
});
export type ModelsState = z.output<typeof modelsStateSchema>;

/**
 * Every model the app can use, with its AI provider, and what the user
 * prefers among them. Shared by every window; re-read from the server when
 * AI providers change.
 */
export const Models = defineDomainObject({
	id: "kilo.core/models",
	home: "main",
	description:
		"Available models with their AI providers, the preferred model, favourites, recent models and the gateway catalog.",
	state: modelsStateSchema,
	lookup: (state, key) => state.models[key],
	objectType: Model,
	methods: {
		/** Reads the AI providers and their models again. */
		refresh: method(nothing, nothing),
		/** Reads the gateway catalog again when it is older than a few minutes. */
		refreshGatewayCatalog: method(nothing, nothing),
		/** A model (and effort) picked for a new chat with `agent`. */
		remember: method(
			z.object({ agent: z.string().min(1), model: modelRefSchema, variant: z.string().optional() }),
			nothing,
		),
		/** A model picked for an existing chat. */
		recordRecent: method(modelRefSchema, nothing),
		setFavorite: method(modelRefSchema.extend({ favorite: z.boolean() }), nothing),
		setAutoFreeModels: method(z.object({ enabled: z.boolean() }), nothing),
		/** Stores an API key for an AI provider in Kilo. */
		connectAiProvider: method(
			z.object({ aiProviderId: aiProviderIdSchema, apiKey: z.string().trim().min(1) }),
			nothing,
		),
		/** Removes its stored key, and the provider itself when it is a custom one. */
		disconnectAiProvider: method(z.object({ aiProviderId: aiProviderIdSchema }), nothing),
		/** Adds or replaces an OpenAI-compatible AI provider in the user's Kilo config. */
		saveCustomAiProvider: method(customAiProviderSchema, nothing),
		/** The custom AI provider as saved, for editing; its key is masked. Null when absent. */
		customAiProvider: method(
			z.object({ aiProviderId: aiProviderIdSchema }),
			customAiProviderSchema.nullable(),
		),
		/** Which of these environment variables are set. */
		presentEnv: method(
			z.object({ names: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(32) }),
			z.object({ names: z.array(z.string()) }),
		),
	},
});

/** What an AI provider contribution gives Kilo, read whenever its config is reconciled. */
export interface AiProviderConfig {
	/**
	 * The provider's entry under Kilo v2's `providers` config, in its own shape
	 * (`Config.Provider`: `name`, `package`, `settings`, `models`…).
	 */
	readonly entry: Readonly<Record<string, unknown>>;
	/**
	 * Environment the entry refers to (`{env:NAME}`), given to the server
	 * process. `PATH`, proxies and `KILO_` / `XDG_` / loader variables are refused.
	 */
	readonly env?: Readonly<Record<string, string>>;
}

export interface AiProviderSource {
	/** Undefined removes the provider. */
	read(): AiProviderConfig | undefined;
	subscribe?(onChange: () => void): () => void;
}

/**
 * An AI provider entry in Kilo's config, owned by the contributing plugin
 * (the local model server). A change to its entry rewrites the app-owned
 * config; a change to its env restarts a running server.
 */
export const AiProviderPoint = defineExtensionPoint({
	id: "kilo.core/ai-provider",
	kind: "additive",
	description: "An AI provider entry in Kilo's config.",
	metadata: z.object({ aiProviderId: aiProviderIdSchema }),
	implementation: implementation<AiProviderSource>("main"),
});
