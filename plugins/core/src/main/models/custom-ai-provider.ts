import { z } from "zod";

import {
	customAiProviderSchema,
	type CustomAiProvider,
	type CustomAiProviderApiFormat,
} from "../../contracts";

/**
 * Custom (OpenAI-compatible) AI providers as entries of Kilo's `provider`
 * config. The contract's `CustomAiProvider` is Kilo-neutral; this converts it
 * to and from the entry shape Kilo reads, and works out the patch Kilo's
 * deep-merging `global.config.update` needs to drop what the user removed.
 */

export const CUSTOM_PROVIDER_PACKAGES = [
	"@ai-sdk/openai-compatible",
	"@ai-sdk/openai",
	"@ai-sdk/anthropic",
] as const;

export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[number];

export const CUSTOM_PROVIDER_PACKAGE: CustomProviderPackage = "@ai-sdk/openai-compatible";

const API_FORMAT_PACKAGES: Readonly<Record<CustomAiProviderApiFormat, CustomProviderPackage>> = {
	"openai-compatible": "@ai-sdk/openai-compatible",
	"openai-responses": "@ai-sdk/openai",
	"anthropic-messages": "@ai-sdk/anthropic",
};

function apiFormatOf(npm: CustomProviderPackage): CustomAiProviderApiFormat {
	const entry = Object.entries(API_FORMAT_PACKAGES).find(([, value]) => value === npm);
	return entry![0] as CustomAiProviderApiFormat;
}

/** Stands in for a stored key when a custom provider is read back for editing. */
export const MASKED_API_KEY = "********";

const INVALID_BASE_URL = "Base URL must start with http:// or https://";

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
	return CUSTOM_PROVIDER_PACKAGES.includes(value as CustomProviderPackage);
}

const modalitySchema = z.enum(["text", "audio", "image", "video", "pdf"]);

const modelModalitiesSchema = z.object({
	input: z.array(modalitySchema).optional(),
	output: z.array(modalitySchema).optional(),
});

export type ModelModalities = z.infer<typeof modelModalitiesSchema>;

/** Kilo's limits; 0 means unknown, as Kilo reads it. */
const modelLimitSchema = z.object({
	context: z.number().int().nonnegative(),
	output: z.number().int().nonnegative(),
});

const kiloProviderEntrySchema = z
	.object({
		npm: z.enum(CUSTOM_PROVIDER_PACKAGES).default(CUSTOM_PROVIDER_PACKAGE),
		name: z.string().trim().min(1).max(200),
		options: z
			.object({
				baseURL: z
					.string()
					.trim()
					.pipe(z.url())
					.refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
						message: INVALID_BASE_URL,
					}),
				headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
			})
			.strict(),
		models: z
			.record(
				z.string().trim().min(1),
				z
					.object({
						name: z.string().trim().min(1).max(200),
						reasoning: z.boolean().optional(),
						modalities: modelModalitiesSchema.optional(),
						limit: modelLimitSchema.optional(),
					})
					.strict(),
			)
			.refine((value) => Object.keys(value).length > 0, "At least one model is required"),
	})
	.strict();

export interface KiloProviderEntry {
	npm: CustomProviderPackage;
	name: string;
	options: { baseURL: string; headers?: Record<string, string> };
	models: Record<
		string,
		{
			name: string;
			reasoning?: true;
			modalities?: ModelModalities;
			limit?: { context: number; output: number };
		}
	>;
}

export type ApiKeyChange = { mode: "preserve" } | { mode: "clear" } | { mode: "set"; key: string };

/** Omitted or still masked keeps the stored key; empty removes it. */
export function resolveApiKeyChange(apiKey: string | undefined): ApiKeyChange {
	if (apiKey === undefined || apiKey === MASKED_API_KEY) return { mode: "preserve" };
	const key = apiKey.trim();
	return key ? { mode: "set", key } : { mode: "clear" };
}

/** Image input follows the attachments switch; other modalities are kept as they were. */
export function resolveModalities(
	existing: ModelModalities | undefined,
	images: boolean,
): ModelModalities | undefined {
	if (images) {
		return {
			input: [...new Set([...(existing?.input ?? []), "text" as const, "image" as const])],
			output: existing?.output ?? ["text"],
		};
	}
	if (!existing) return undefined;
	return {
		...(existing.input ? { input: existing.input.filter((value) => value !== "image") } : {}),
		...(existing.output ? { output: existing.output } : {}),
	};
}

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function withoutApiKey(entry: unknown): unknown {
	if (!isRecord(entry) || !isRecord(entry.options)) return entry;
	const { apiKey: _secret, ...options } = entry.options;
	return { ...entry, options };
}

function normalize(entry: z.output<typeof kiloProviderEntrySchema>): KiloProviderEntry {
	const headers = entry.options.headers
		? Object.fromEntries(
				Object.entries(entry.options.headers).map(([key, value]) => [key.trim(), value.trim()]),
			)
		: undefined;
	return {
		npm: entry.npm,
		name: entry.name.trim(),
		options: {
			baseURL: entry.options.baseURL.trim(),
			...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		},
		models: Object.fromEntries(
			Object.entries(entry.models).map(([id, model]) => [
				id.trim(),
				{
					name: model.name.trim(),
					...(model.reasoning ? { reasoning: true as const } : {}),
					...(model.modalities ? { modalities: model.modalities } : {}),
					...(model.limit ? { limit: model.limit } : {}),
				},
			]),
		),
	};
}

/** Validates and normalizes a provider entry; a key in its options never survives. */
export function sanitizeKiloProviderEntry(
	entry: unknown,
): { value: KiloProviderEntry } | { error: string } {
	const result = kiloProviderEntrySchema.safeParse(withoutApiKey(entry));
	if (!result.success) {
		return { error: result.error.issues[0]?.message ?? "Invalid custom AI provider" };
	}
	return { value: normalize(result.data) };
}

function existingModalities(existing: unknown, modelId: string): ModelModalities | undefined {
	if (!isRecord(existing) || !isRecord(existing.models)) return undefined;
	const model = existing.models[modelId];
	if (!isRecord(model)) return undefined;
	const parsed = modelModalitiesSchema.safeParse(model.modalities);
	return parsed.success ? parsed.data : undefined;
}

/**
 * The entry to write for a custom provider. Without an `apiFormat` it keeps
 * the package of an existing entry (it may use the OpenAI or Anthropic SDK) and, when
 * `attachments` is unset, the modalities it had.
 */
export function toKiloProviderEntry(
	provider: z.output<typeof customAiProviderSchema>,
	existing: unknown,
): { value: KiloProviderEntry } | { error: string } {
	const existingNpm = isRecord(existing) ? existing.npm : undefined;
	const keptNpm = isCustomProviderPackage(existingNpm) ? existingNpm : CUSTOM_PROVIDER_PACKAGE;
	return sanitizeKiloProviderEntry({
		npm: provider.apiFormat ? API_FORMAT_PACKAGES[provider.apiFormat] : keptNpm,
		name: provider.name,
		options: {
			baseURL: provider.baseUrl,
			...(provider.headers ? { headers: provider.headers } : {}),
		},
		models: Object.fromEntries(
			provider.models.map((model) => {
				const id = model.modelId.trim();
				const previous = existingModalities(existing, id);
				const modalities =
					model.attachments === undefined
						? previous
						: resolveModalities(previous, model.attachments);
				const hasLimit = model.contextWindow !== undefined || model.maxOutputTokens !== undefined;
				return [
					id,
					{
						name: model.name,
						...(model.reasoning ? { reasoning: true } : {}),
						...(modalities ? { modalities } : {}),
						...(hasLimit
							? { limit: { context: model.contextWindow ?? 0, output: model.maxOutputTokens ?? 0 } }
							: {}),
					},
				];
			}),
		),
	});
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * A custom provider's entry as the contract shape, for editing; null when the
 * entry isn't a custom provider the form can show.
 */
export function fromKiloProviderEntry(
	aiProviderId: string,
	entry: unknown,
	hasStoredKey: boolean,
): z.output<typeof customAiProviderSchema> | null {
	if (!isRecord(entry) || !isCustomProviderPackage(entry.npm)) return null;
	const options = isRecord(entry.options) ? entry.options : {};
	const models = isRecord(entry.models) ? entry.models : {};
	const headers = stringRecord(options.headers);
	const candidate: CustomAiProvider = {
		aiProviderId,
		name: typeof entry.name === "string" ? entry.name : aiProviderId,
		baseUrl: typeof options.baseURL === "string" ? options.baseURL : "",
		apiFormat: apiFormatOf(entry.npm),
		...(hasStoredKey ? { apiKey: MASKED_API_KEY } : {}),
		...(headers ? { headers } : {}),
		models: Object.entries(models).flatMap(([modelId, model]) => {
			if (!isRecord(model)) return [];
			const modalities = modelModalitiesSchema.safeParse(model.modalities);
			const limit = isRecord(model.limit) ? model.limit : {};
			const contextWindow = positive(limit.context);
			const maxOutputTokens = positive(limit.output);
			return [
				{
					modelId,
					name: typeof model.name === "string" && model.name.trim() ? model.name : modelId,
					...(model.reasoning === true ? { reasoning: true } : {}),
					...(modalities.success && modalities.data.input?.includes("image")
						? { attachments: true }
						: {}),
					...(contextWindow ? { contextWindow } : {}),
					...(maxOutputTokens ? { maxOutputTokens } : {}),
				},
			];
		}),
	};
	const parsed = customAiProviderSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}

type ProviderPatch = Omit<KiloProviderEntry, "models" | "options"> & {
	options: Omit<KiloProviderEntry["options"], "headers"> & {
		headers?: Record<string, string | null> | null;
	};
	models: Record<
		string,
		null | {
			name: string;
			reasoning?: true | null;
			modalities?: ModelModalities | null;
			limit?: { context: number; output: number } | null;
		}
	>;
};

/**
 * Kilo's `global.config.update` deep-merges. Null sentinels delete models,
 * headers and model fields that existed on disk but are gone from the next entry.
 */
export function withCustomProviderDeletions(
	existing: unknown,
	next: KiloProviderEntry,
): ProviderPatch {
	if (!isRecord(existing)) return next;
	const oldModels = isRecord(existing.models) ? existing.models : {};
	const patched: ProviderPatch["models"] = { ...next.models };
	const oldOptions = isRecord(existing.options) ? existing.options : {};
	const oldHeaders = isRecord(oldOptions.headers) ? oldOptions.headers : {};
	const nextHeaders = next.options.headers;
	const headers = (() => {
		if (Object.keys(oldHeaders).length === 0) return nextHeaders;
		if (!nextHeaders || Object.keys(nextHeaders).length === 0) return null;
		return {
			...nextHeaders,
			...Object.fromEntries(
				Object.keys(oldHeaders)
					.filter((key) => !(key in nextHeaders))
					.map((key) => [key, null]),
			),
		};
	})();

	for (const id of Object.keys(oldModels)) {
		const oldModel = oldModels[id];
		const newModel = patched[id];
		if (!newModel) {
			patched[id] = null;
			continue;
		}
		if (!isRecord(oldModel)) continue;
		patched[id] = {
			...newModel,
			...(oldModel.reasoning !== undefined && newModel.reasoning === undefined
				? { reasoning: null }
				: {}),
			...(oldModel.modalities !== undefined && newModel.modalities === undefined
				? { modalities: null }
				: {}),
			...(oldModel.limit !== undefined && newModel.limit === undefined ? { limit: null } : {}),
		};
	}

	return {
		...next,
		options: { ...next.options, ...(headers !== undefined ? { headers } : {}) },
		models: patched,
	};
}
