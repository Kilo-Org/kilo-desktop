import { z } from "zod";

const modelQuantizedFileSchema = z.object({
	file_uuid: z.string().min(1),
	format: z.string().optional(),
	quant_method: z.string().nullable().optional(),
	size_bytes: z.number().int().positive().optional(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.nullable()
		.optional(),
	published: z.boolean().nullable().optional(),
});

export const modelDownloadUrlResponseSchema = z.object({
	download_url: z.url(),
});

export const modelCatalogApiResponseSchema = z.object({
	result: z.object({
		data: z.array(
			z.object({
				model_uuid: z.string().min(1),
				name: z.string().min(1),
				description: z.string(),
				num_parameters: z.number().int().nonnegative(),
				model_type: z.string(),
				trained_for: z.string(),
				library_name: z.string(),
				license: z.string(),
				context_window_size: z.number().int().nonnegative(),
				first_published: z.string().nullable().optional(),
				modality: z.string().nullable().optional(),
				supports_tool_calling: z.boolean().default(false),
				vision_metadata: z.object({}).passthrough().nullable().optional(),
				source: z.object({ name: z.string() }),
				tags: z.array(z.object({ name: z.string().min(1) })).default([]),
				quantized_files: z.array(modelQuantizedFileSchema).default([]),
			}),
		),
		total: z.number().int().nonnegative(),
	}),
});

export type ModelCatalogApiResponse = z.infer<typeof modelCatalogApiResponseSchema>;
