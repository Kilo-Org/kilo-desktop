import { z } from "zod";

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

export const modelDownloadIdentitySchema = modelDownloadSchema.pick({
	modelId: true,
	quantizationId: true,
});

export type ModelDownloadIdentity = z.infer<typeof modelDownloadIdentitySchema>;
