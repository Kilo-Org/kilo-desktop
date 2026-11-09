import { z } from "zod";

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
