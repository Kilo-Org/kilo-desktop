import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const modelPreferenceRefSchema = z.object({
	providerID: z.string().min(1),
	modelID: z.string().min(1),
});
export type ModelPreferenceRef = z.infer<typeof modelPreferenceRefSchema>;

export const persistedModelPreferencesSchema = z.object({
	modelSelections: z.record(z.string(), modelPreferenceRefSchema),
	preferred: modelPreferenceRefSchema.extend({ variant: z.string() }).optional(),
	variantSelections: z.record(z.string(), z.string()),
	recentModels: z.array(modelPreferenceRefSchema).max(5),
});
export type PersistedModelPreferences = z.infer<typeof persistedModelPreferencesSchema>;

const rememberModelPreferenceSchema = z.object({
	agent: z.string().min(1),
	model: modelPreferenceRefSchema,
	effort: z.string().optional(),
});

export const modelPreferencesContract = defineContract({
	"modelPreferences.get": defineMethod(z.undefined(), persistedModelPreferencesSchema),
	"modelPreferences.remember": defineMethod(
		rememberModelPreferenceSchema,
		persistedModelPreferencesSchema,
	),
	"modelPreferences.recordRecent": defineMethod(
		modelPreferenceRefSchema,
		persistedModelPreferencesSchema,
	),
});

export type ModelPreferencesService = InferContract<typeof modelPreferencesContract>;
