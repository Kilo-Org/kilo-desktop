import { z } from "zod";

import { FeatureError, type MainSdkFetch } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { ModelCatalog } from "../contracts/schemas.js";

const MODEL_CATALOG_URL = "https://anaconda.com/api/ai/model/models";
const ESTIMATED_MOE_ACTIVE_PARAMETER_RATIO = 0.12;

const parameterUnitMultipliers: Record<string, number> = {
	k: 1_000,
	m: 1_000_000,
	b: 1_000_000_000,
	t: 1_000_000_000_000,
};

const activeParameterNamePattern = /(?:^|[^a-z0-9])a(\d+(?:\.\d+)?)\s*([kmbt])(?:$|[^a-z0-9])/i;
const activeParameterDescriptionPattern =
	/(\d+(?:\.\d+)?)\s*([kmbt])\s+(?:active|activated)(?:\s+parameters?)?/i;
const mixtureOfExpertsPattern = /moe|mixture[\s-]+of[\s-]+experts?/i;
const expertCountPattern = /(?:^|[^a-z0-9])\d+\s*e(?:$|[^a-z0-9])/i;
const efficientGemmaParameterCounts: ReadonlyArray<readonly [RegExp, number]> = [
	[/gemma[\s._-]*(?:3n|4)[\s._-]*e2b/i, 5_000_000_000],
	[/gemma[\s._-]*(?:3n|4)[\s._-]*e4b/i, 8_000_000_000],
];

interface ActiveParameterApiMetadata {
	readonly name: string;
	readonly description: string;
	readonly modelType: string;
	readonly tags: readonly string[];
}

interface ActiveParameterEstimate {
	readonly count: number;
	readonly estimated: boolean;
}

function parameterCountFromMatch(match: RegExpMatchArray | null): number | null {
	if (!match?.[1] || !match[2]) return null;

	const value = Number.parseFloat(match[1]);
	const multiplier = parameterUnitMultipliers[match[2].toLowerCase()];
	if (!Number.isFinite(value) || !multiplier) return null;

	return Math.round(value * multiplier);
}

function marketedParameterCount(name: string): number | null {
	const efficientGemmaCount = efficientGemmaParameterCounts.find(([pattern]) =>
		pattern.test(name),
	)?.[1];
	if (efficientGemmaCount) return efficientGemmaCount;
	if (expertCountPattern.test(name)) return null;

	for (const match of name.matchAll(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*([kmbt])(?=$|[^a-z0-9])/gi)) {
		const count = parameterCountFromMatch(match);
		if (count) return count;
	}

	return null;
}

function estimateActiveParameters(
	metadata: ActiveParameterApiMetadata,
	totalParameters: number,
): ActiveParameterEstimate {
	if (totalParameters <= 0) return { count: 0, estimated: false };

	const namedActiveParameterCount = parameterCountFromMatch(
		metadata.name.match(activeParameterNamePattern),
	);
	const architectureMetadata = [metadata.name, metadata.modelType, ...metadata.tags].join(" ");
	const isMixtureOfExperts =
		Boolean(namedActiveParameterCount) || mixtureOfExpertsPattern.test(architectureMetadata);
	const explicitCount =
		(isMixtureOfExperts
			? parameterCountFromMatch(metadata.description.match(activeParameterDescriptionPattern))
			: null) ?? namedActiveParameterCount;
	if (explicitCount && explicitCount <= totalParameters) {
		return { count: explicitCount, estimated: false };
	}

	if (isMixtureOfExperts) {
		return {
			count: Math.max(1, Math.round(totalParameters * ESTIMATED_MOE_ACTIVE_PARAMETER_RATIO)),
			estimated: true,
		};
	}

	return { count: totalParameters, estimated: false };
}

const modelTypeLabels: Record<string, string> = {
	"any-to-any": "Any to Any",
	"image-text-to-text": "Image Text to Text",
	"sentence-similarity": "Sentence Similarity",
	"text-generation": "Text Generation",
};

function getModelTypeLabel(trainedFor: string): string {
	return modelTypeLabels[trainedFor] ?? trainedFor;
}

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

const modelDownloadUrlResponseSchema = z.object({
	download_url: z.url(),
});

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

const modelCatalogApiResponseSchema = z.object({
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

export interface AuthMainCapability extends Record<string, unknown> {
	session: {
		getApiKey(): Promise<string | null>;
	};
}

export interface ModelCatalogDependencies {
	fetch: MainSdkFetch;
	getApiKey(): Promise<string | null>;
}

export async function listModelCatalog({
	fetch,
	getApiKey,
}: ModelCatalogDependencies): Promise<ModelCatalog> {
	const apiKey = await getApiKey();
	if (!apiKey) {
		throw new FeatureError("Sign in to your Anaconda account to view the model catalog.");
	}

	let response: Response;
	try {
		response = await fetch(MODEL_CATALOG_URL, {
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
				"X-Anaconda-Api-Version": "3",
			},
		});
	} catch {
		throw new FeatureError("The Anaconda model catalog could not be loaded.");
	}

	if (!response.ok) {
		const message =
			response.status === 401 || response.status === 403
				? "Your Anaconda account does not have access to the model catalog."
				: "The Anaconda model catalog could not be loaded.";
		throw new FeatureError(message);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new FeatureError("The Anaconda model catalog returned an invalid response.");
	}

	const parsed = modelCatalogApiResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new FeatureError("The Anaconda model catalog returned an invalid response.");
	}

	const models = parsed.data.result.data
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

	return {
		models,
		total: models.length,
	};
}

export async function getModelDownloadUrl(
	{ fetch, getApiKey }: ModelCatalogDependencies,
	modelId: string,
	fileId: string,
	signal: AbortSignal,
): Promise<string> {
	const apiKey = await abortable(getApiKey(), signal);
	if (!apiKey) {
		throw new FeatureError("Sign in to your Anaconda account to download models.");
	}

	let response: Response;
	try {
		response = await fetch(
			`${MODEL_CATALOG_URL}/${encodeURIComponent(modelId)}/files/${encodeURIComponent(fileId)}/download`,
			{
				signal,
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${apiKey}`,
					"X-Anaconda-Api-Version": "3",
				},
			},
		);
	} catch (error) {
		if (signal.aborted) throw error;
		throw new FeatureError("The model download could not be started.");
	}

	if (!response.ok) {
		const message =
			response.status === 401 || response.status === 403
				? "Your Anaconda account does not have access to this model."
				: "The model download could not be started.";
		throw new FeatureError(message);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new FeatureError("The model download returned an invalid response.");
	}
	const parsed = modelDownloadUrlResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new FeatureError("The model download returned an invalid response.");
	}
	return parsed.data.download_url;
}
