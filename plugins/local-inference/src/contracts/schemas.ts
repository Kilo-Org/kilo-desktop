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

export const localInferenceUsageSchema = z.object({
	system: z.object({
		cpuPercent: z.number().finite().min(0).max(100),
		cpuSpeedGHz: z.number().finite().nonnegative().nullable(),
		gpuMemoryUsedBytes: z.number().int().nonnegative().nullable(),
		gpuMemoryTotalBytes: z.number().int().nonnegative().nullable(),
		memoryUsedBytes: z.number().int().nonnegative(),
		memoryTotalBytes: z.number().int().nonnegative(),
	}),
});

export type LocalInferenceUsage = z.infer<typeof localInferenceUsageSchema>;

export const localInferenceHardwareProfileSchema = z.object({
	name: z.string().min(1),
	kind: z.enum(["unified-memory", "dedicated-gpu", "system-memory", "mobile"]),
	accelerator: z.enum(["metal", "cuda", "vulkan", "cpu"]),
	memoryTotalBytes: z.number().int().nonnegative(),
	systemMemoryTotalBytes: z.number().int().nonnegative(),
	memoryBandwidthGBps: z.number().finite().positive().nullable(),
});

export type LocalInferenceHardwareProfile = z.infer<typeof localInferenceHardwareProfileSchema>;

export const modelCatalogCapabilitiesSchema = z.object({
	chat: z.boolean(),
	embedding: z.boolean(),
	vision: z.boolean(),
	toolCalling: z.boolean(),
});

export type ModelCatalogCapabilities = z.infer<typeof modelCatalogCapabilitiesSchema>;

export const modelCatalogQuantizationSchema = z.object({
	id: z.string().min(1),
	method: z.string().min(1),
	sizeBytes: z.number().int().positive(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type ModelCatalogQuantization = z.infer<typeof modelCatalogQuantizationSchema>;

export const modelCatalogEntrySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	numParameters: z.number().int().nonnegative(),
	activeParameters: z.number().int().nonnegative().optional(),
	activeParametersEstimated: z.boolean().optional(),
	modelType: z.string(),
	publisher: z.string(),
	libraryName: z.string(),
	license: z.string(),
	contextWindowSize: z.number().int().nonnegative(),
	publishedAt: z.string().nullable().optional(),
	tags: z.array(z.string()).default([]),
	quantizations: z.array(modelCatalogQuantizationSchema).default([]),
	capabilities: modelCatalogCapabilitiesSchema.default({
		chat: false,
		embedding: false,
		vision: false,
		toolCalling: false,
	}),
});

export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

export const modelCatalogSchema = z.object({
	models: z.array(modelCatalogEntrySchema),
	total: z.number().int().nonnegative(),
});

export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

export const modelDownloadStatusSchema = z.enum([
	"downloading",
	"cancelling",
	"completed",
	"failed",
	"cancelled",
]);

export const modelDownloadSchema = z.object({
	modelId: z.string().min(1),
	quantizationId: z.string().min(1),
	status: modelDownloadStatusSchema,
	transferredBytes: z.number().int().nonnegative(),
	totalBytes: z.number().int().positive(),
	percentage: z.number().int().min(0).max(100),
	error: z.string().min(1).optional(),
});

export type ModelDownload = z.infer<typeof modelDownloadSchema>;

const modelDownloadIdentitySchema = modelDownloadSchema.pick({
	modelId: true,
	quantizationId: true,
});

export const localInferenceContract = defineContract({
	"catalog.list": defineMethod(z.undefined(), modelCatalogSchema),
	"catalog.download.start": defineMethod(modelDownloadIdentitySchema, modelDownloadSchema),
	"catalog.download.cancel": defineMethod(modelDownloadIdentitySchema, modelDownloadSchema),
	"catalog.downloads.list": defineMethod(z.undefined(), z.array(modelDownloadSchema)),
	"hardware.profile": defineMethod(z.undefined(), localInferenceHardwareProfileSchema),
	"models.list": defineMethod(z.undefined(), z.array(localModelSchema)),
	"models.add": defineMethod(
		z.object({
			path: z.string().min(1).max(32_768),
			name: z.string().trim().min(1).max(200).optional(),
		}),
		localModelSchema,
	),
	"models.remove": defineMethod(
		z.object({
			id: z.string().min(1),
			mode: z.enum(["registry-only", "delete-managed-file"]),
		}),
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
	"usage.get": defineMethod(z.undefined(), localInferenceUsageSchema),
});

export type LocalInferenceServiceContract = InferContract<typeof localInferenceContract>;

export interface LocalInferenceCapabilities extends Record<string, unknown> {
	localInference: {
		prepareModel(modelId: string): Promise<void>;
	};
}
