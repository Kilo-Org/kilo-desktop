import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

const llamaFlagsSchema = z.record(z.string(), z.string()).optional();

export const localModelSettingsSchema = z.object({
	temperature: z.number().optional(),
	contextLength: z.number().int().optional(),
	maxResponseTokens: z.number().int().optional(),
	includeKiloContext: z.boolean().optional(),
	llamaFlags: llamaFlagsSchema,
});

export type LocalModelSettings = z.infer<typeof localModelSettingsSchema>;

export const localServerSettingsSchema = z.object({
	port: z.number().int().optional(),
	maxModels: z.number().int().optional(),
	serveOnLocalNetwork: z.boolean().optional(),
	llamaFlags: llamaFlagsSchema,
});

export type LocalServerSettings = z.infer<typeof localServerSettingsSchema>;

export const localModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	path: z.string().min(1),
	available: z.boolean(),
	addedAt: z.number(),
	settings: localModelSettingsSchema.optional(),
});

export type LocalModel = z.infer<typeof localModelSchema>;

export const localConnectionSchema = z.object({
	port: z.number(),
	baseUrl: z.string(),
	apiKey: z.string(),
});

export type LocalConnectionInfo = z.infer<typeof localConnectionSchema>;

export const localInferenceStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("idle") }),
	z.object({ status: z.literal("preparing-runtime") }),
	z.object({ status: z.literal("starting") }),
	z.object({
		status: z.literal("ready"),
		loadedModelId: z.string().optional(),
		loadedModelIds: z.array(z.string()).default([]),
		connection: localConnectionSchema.optional(),
	}),
	z.object({
		status: z.literal("loading-model"),
		modelId: z.string().min(1),
		loadedModelIds: z.array(z.string()).default([]),
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
			path: z.string().min(1),
			name: z.string().optional(),
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
