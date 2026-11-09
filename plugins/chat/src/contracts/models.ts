import { z } from "zod";

import { defineDomain, method } from "@kilo-desktop/kernel";

const nothing = z.undefined();

export const modelRefSchema = z.object({
	providerID: z.string().min(1),
	modelID: z.string().min(1),
});
export type ModelRef = z.output<typeof modelRefSchema>;

/** How many recently used models are remembered. */
export const RECENT_MODELS_LIMIT = 5;

export const modelPreferencesStateSchema = z.object({
	/** The model last picked for a new chat with each agent. */
	modelSelections: z.record(z.string(), modelRefSchema),
	/** The model and effort last picked for a new chat with any agent; new chats start with it. */
	preferred: modelRefSchema.extend({ variant: z.string() }).optional(),
	/** Effort by `agent/provider/model`. */
	variantSelections: z.record(z.string(), z.string()),
	recentModels: z.array(modelRefSchema).max(RECENT_MODELS_LIMIT),
	favorites: z.array(modelRefSchema),
	/**
	 * Opt-out for free (no-sign-in) models; kept from origin, which stored it
	 * without a picker or setting reading it yet.
	 */
	autoFreeModelsEnabled: z.boolean(),
});
export type ModelPreferencesState = z.output<typeof modelPreferencesStateSchema>;

/**
 * The model pickers' remembered choices, shared by every window: what new
 * chats start with, recently used models and favourites.
 */
export const ModelPreferences = defineDomain({
	id: "kilo.chat/model-preferences",
	home: "main",
	state: modelPreferencesStateSchema,
	methods: {
		/** A model (and effort) picked for a new chat with `agent`. */
		remember: method(
			z.object({ agent: z.string().min(1), model: modelRefSchema, effort: z.string().optional() }),
			nothing,
		),
		/** A model picked for an existing chat. */
		recordRecent: method(modelRefSchema, nothing),
		setFavorite: method(modelRefSchema.extend({ favorite: z.boolean() }), nothing),
		setAutoFreeEnabled: method(z.object({ enabled: z.boolean() }), nothing),
		/**
		 * Hands over the favourites origin kept in the window's localStorage.
		 * Applied once; kilo.chat's own windows only.
		 */
		importLegacyFavorites: method(
			z.object({ favorites: z.array(modelRefSchema).max(500) }),
			nothing,
		),
	},
});

export const gatewayModelDetailsSchema = z.object({
	modelID: z.string().min(1),
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

/**
 * The Kilo Gateway's public model catalog (prices, benchmarks, context
 * sizes) the model picker shows next to Kilo's own models. Read in main, so
 * windows share one copy; `refresh` reads it again when it is older than a
 * few minutes.
 */
export const GatewayModels = defineDomain({
	id: "kilo.chat/gateway-models",
	home: "main",
	state: z.object({
		details: z.array(gatewayModelDetailsSchema),
		/** When the catalog was last read; null until it has been. */
		fetchedAt: z.number().nullable(),
	}),
	methods: {
		refresh: method(nothing, nothing),
	},
});
