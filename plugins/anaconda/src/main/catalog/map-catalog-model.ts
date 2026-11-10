import type { ModelCatalog } from "@kilo-desktop/plugin-local-inference/contracts";

import { estimateActiveParameters, marketedParameterCount } from "./active-parameters";
import type { ModelCatalogApiResponse } from "./catalog-api-schemas";

const modelTypeLabels: Record<string, string> = {
	"any-to-any": "Any to Any",
	"image-text-to-text": "Image Text to Text",
	"sentence-similarity": "Sentence Similarity",
	"text-generation": "Text Generation",
};

function getModelTypeLabel(trainedFor: string): string {
	return modelTypeLabels[trainedFor] ?? trainedFor;
}

export function mapModelCatalog(payload: ModelCatalogApiResponse): ModelCatalog {
	const models = payload.result.data
		.map((model) => {
			const tags = model.tags.map((tag) => tag.name);
			const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
			const publishedGgufFiles = model.quantized_files.filter(
				(file) =>
					file.published === true &&
					file.format?.toLowerCase() === "gguf" &&
					Boolean(file.quant_method) &&
					Boolean(file.size_bytes) &&
					Boolean(file.sha256),
			);
			const numParameters = marketedParameterCount(model.name) ?? model.num_parameters;
			const activeParameters = estimateActiveParameters(
				{
					name: model.name,
					description: model.description,
					modelType: model.model_type,
					tags,
				},
				numParameters,
			);

			return {
				id: model.model_uuid,
				name: model.name,
				description: model.description,
				numParameters,
				activeParameters: activeParameters.count,
				activeParametersEstimated: activeParameters.estimated,
				modelType: getModelTypeLabel(model.trained_for),
				publisher: model.source.name,
				libraryName: model.library_name,
				license: model.license,
				contextWindowSize: model.context_window_size,
				publishedAt: model.first_published ?? null,
				tags,
				quantizations: publishedGgufFiles.flatMap((file) => {
					if (!file.quant_method || !file.size_bytes || !file.sha256) return [];
					return [
						{
							id: file.file_uuid,
							method: file.quant_method,
							sizeBytes: file.size_bytes,
							sha256: file.sha256.toLowerCase(),
						},
					];
				}),
				capabilities: {
					chat: model.trained_for === "text-generation" || tagSet.has("chat"),
					embedding:
						model.trained_for === "sentence-similarity" ||
						model.modality === "embedding" ||
						tagSet.has("embedding"),
					vision:
						Boolean(model.vision_metadata) ||
						model.modality === "vision-language" ||
						model.modality === "video-language" ||
						model.trained_for === "image-text-to-text" ||
						model.trained_for === "any-to-any",
					toolCalling: model.supports_tool_calling || tagSet.has("tool-calling"),
				},
			};
		})
		.filter((model) => model.quantizations.length > 0);

	return { models, total: models.length };
}
