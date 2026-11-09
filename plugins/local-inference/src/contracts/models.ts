import { z } from "zod";

import { localModelSettingsSchema } from "../shared/settings/model-settings.js";

export const localModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(200),
	path: z.string().min(1).max(32_768),
	available: z.boolean(),
	addedAt: z.number().int().nonnegative(),
	settings: localModelSettingsSchema.optional(),
	catalog: z
		.object({
			modelId: z.string().min(1),
			quantizationId: z.string().min(1),
			publisher: z.string().min(1).max(200).optional(),
		})
		.optional(),
	managedFile: z.boolean().optional(),
	sizeBytes: z.number().int().positive().optional(),
});

export type LocalModel = z.infer<typeof localModelSchema>;
