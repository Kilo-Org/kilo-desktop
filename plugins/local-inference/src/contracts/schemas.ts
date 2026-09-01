import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

import { localModelSettingsSchema } from "../shared/model-settings.js";
import { localServerSettingsSchema } from "../shared/server-settings.js";

export { localModelSettingsSchema, localServerSettingsSchema };
export type { LocalModelSettings } from "../shared/model-settings.js";
export type { LocalServerSettings } from "../shared/server-settings.js";

export const localModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(200),
	path: z.string().min(1).max(32_768),
	available: z.boolean(),
	addedAt: z.number().int().nonnegative(),
	settings: localModelSettingsSchema.optional(),
});

export type LocalModel = z.infer<typeof localModelSchema>;

export const localConnectionSchema = z.object({
	port: z.number().int().positive(),
	baseUrl: z.url(),
	apiKey: z.string().min(1),
});

export type LocalConnectionInfo = z.infer<typeof localConnectionSchema>;

export const localInferenceStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("idle") }),
	z.object({ status: z.literal("preparing-runtime") }),
	z.object({ status: z.literal("starting") }),
	z.object({
		status: z.literal("ready"),
		loadedModelId: z.string().min(1).optional(),
		loadedModelIds: z.array(z.string().min(1)).default([]),
		connection: localConnectionSchema.optional(),
	}),
	z.object({
		status: z.literal("loading-model"),
		modelId: z.string().min(1),
		loadedModelIds: z.array(z.string().min(1)).default([]),
	}),
	z.object({ status: z.literal("error"), message: z.string().min(1) }),
	z.object({ status: z.literal("stopping") }),
	z.object({ status: z.literal("disconnected") }),
]);

export type LocalInferenceStatus = z.infer<typeof localInferenceStatusSchema>;

export const localInferenceContract = defineContract({
	"models.list": defineMethod(z.undefined(), z.array(localModelSchema)),
	"models.add": defineMethod(
		z.object({
			path: z.string().min(1).max(32_768),
			name: z.string().trim().min(1).max(200).optional(),
		}),
		localModelSchema,
	),
	"models.remove": defineMethod(
		z.object({ id: z.string().min(1) }),
		z.object({ ok: z.literal(true) }),
	),
	"models.update": defineMethod(
		z.object({
			id: z.string().min(1),
			settings: localModelSettingsSchema,
		}),
		localModelSchema,
	),
	"models.prepare": defineMethod(
		z.object({ modelId: z.string().min(1) }),
		z.object({ ok: z.literal(true) }),
	),
	"runtime.retry": defineMethod(z.undefined(), z.object({ ok: z.literal(true) })),
	"runtime.disconnect": defineMethod(z.undefined(), z.object({ ok: z.literal(true) })),
	"runtime.connect": defineMethod(z.undefined(), z.object({ ok: z.literal(true) })),
	"settings.get": defineMethod(z.undefined(), localServerSettingsSchema),
	"settings.update": defineMethod(localServerSettingsSchema, localServerSettingsSchema),
	"status.get": defineMethod(z.undefined(), localInferenceStatusSchema),
});

export type LocalInferenceServiceContract = InferContract<typeof localInferenceContract>;

export interface LocalInferenceCapabilities extends Record<string, unknown> {
	localInference: {
		prepareModel(modelId: string): Promise<void>;
	};
}
