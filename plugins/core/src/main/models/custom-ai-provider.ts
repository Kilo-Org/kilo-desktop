import { z } from "zod";

import {
	customAiProviderSchema,
	type CustomAiProvider,
	type CustomAiProviderApiFormat,
} from "../../contracts";

/**
 * Custom (OpenAI-compatible) AI providers as entries of Kilo v2's `providers`
 * config (`Config.Provider`). The contract's `CustomAiProvider` is
 * Kilo-neutral; this converts it to and from the entry shape Kilo reads, and
 * works out the leaf writes `kilocode.settings` needs to drop what the user
 * removed.
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

/** A model's input and output kinds (`capabilities.input` / `output`). */
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

const modelCapabilitiesSchema = modelModalitiesSchema.extend({
	reasoning: z.object({ supported: z.boolean() }).optional(),
});

const kiloProviderEntrySchema = z
	.object({
		package: z.enum(CUSTOM_PROVIDER_PACKAGES).default(CUSTOM_PROVIDER_PACKAGE),
		name: z.string().trim().min(1).max(200),
		settings: z
			.object({
				baseURL: z
					.string()
					.trim()
					.pipe(z.url())
					.refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
						message: INVALID_BASE_URL,
					}),
			})
			.strict(),
		headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
		models: z
			.record(
				z.string().trim().min(1),
				z
					.object({
						name: z.string().trim().min(1).max(200),
						capabilities: modelCapabilitiesSchema.optional(),
						limit: modelLimitSchema.optional(),
					})
					.strict(),
			)
			.refine((value) => Object.keys(value).length > 0, "At least one model is required"),
	})
	.strict();

interface KiloModelCapabilities extends ModelModalities {
	reasoning?: { supported: true };
}

export interface KiloProviderEntry {
	package: CustomProviderPackage;
	name: string;
	settings: { baseURL: string };
	headers?: Record<string, string>;
	models: Record<
		string,
		{
			name: string;
			capabilities?: KiloModelCapabilities;
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
function resolveModalities(
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

/** A key typed into the entry's settings never survives: keys live in Kilo's credential store. */
function withoutApiKey(entry: unknown): unknown {
	if (!isRecord(entry) || !isRecord(entry.settings)) return entry;
	const { apiKey: _secret, ...settings } = entry.settings;
	return { ...entry, settings };
}

function capabilitiesOf(
	modalities: ModelModalities | undefined,
	reasoning: boolean,
): KiloModelCapabilities | undefined {
	const capabilities: KiloModelCapabilities = {
		...(modalities?.input ? { input: modalities.input } : {}),
		...(modalities?.output ? { output: modalities.output } : {}),
		...(reasoning ? { reasoning: { supported: true as const } } : {}),
	};
	return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

function normalize(entry: z.output<typeof kiloProviderEntrySchema>): KiloProviderEntry {
	const headers = entry.headers
		? Object.fromEntries(
				Object.entries(entry.headers).map(([key, value]) => [key.trim(), value.trim()]),
			)
		: undefined;
	return {
		package: entry.package,
		name: entry.name.trim(),
		settings: { baseURL: entry.settings.baseURL.trim() },
		...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		models: Object.fromEntries(
			Object.entries(entry.models).map(([id, model]) => {
				const capabilities = capabilitiesOf(
					model.capabilities,
					model.capabilities?.reasoning?.supported === true,
				);
				return [
					id.trim(),
					{
						name: model.name.trim(),
						...(capabilities ? { capabilities } : {}),
						...(model.limit ? { limit: model.limit } : {}),
					},
				];
			}),
		),
	};
}

/** Validates and normalizes a provider entry; a key in its settings never survives. */
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
	const parsed = modelModalitiesSchema.safeParse(model.capabilities);
	if (!parsed.success) return undefined;
	const { input, output } = parsed.data;
	return input || output
		? { ...(input ? { input } : {}), ...(output ? { output } : {}) }
		: undefined;
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
	const existingPackage = isRecord(existing) ? existing.package : undefined;
	const keptPackage = isCustomProviderPackage(existingPackage)
		? existingPackage
		: CUSTOM_PROVIDER_PACKAGE;
	return sanitizeKiloProviderEntry({
		package: provider.apiFormat ? API_FORMAT_PACKAGES[provider.apiFormat] : keptPackage,
		name: provider.name,
		settings: { baseURL: provider.baseUrl },
		...(provider.headers ? { headers: provider.headers } : {}),
		models: Object.fromEntries(
			provider.models.map((model) => {
				const id = model.modelId.trim();
				const previous = existingModalities(existing, id);
				const modalities =
					model.attachments === undefined
						? previous
						: resolveModalities(previous, model.attachments);
				const capabilities = capabilitiesOf(modalities, model.reasoning === true);
				const hasLimit = model.contextWindow !== undefined || model.maxOutputTokens !== undefined;
				return [
					id,
					{
						name: model.name,
						...(capabilities ? { capabilities } : {}),
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
	if (!isRecord(entry) || !isCustomProviderPackage(entry.package)) return null;
	const settings = isRecord(entry.settings) ? entry.settings : {};
	const models = isRecord(entry.models) ? entry.models : {};
	const headers = stringRecord(entry.headers);
	const candidate: CustomAiProvider = {
		aiProviderId,
		name: typeof entry.name === "string" ? entry.name : aiProviderId,
		baseUrl: typeof settings.baseURL === "string" ? settings.baseURL : "",
		apiFormat: apiFormatOf(entry.package),
		...(hasStoredKey ? { apiKey: MASKED_API_KEY } : {}),
		...(headers ? { headers } : {}),
		models: Object.entries(models).flatMap(([modelId, model]) => {
			if (!isRecord(model)) return [];
			const capabilities = isRecord(model.capabilities) ? model.capabilities : {};
			const input = Array.isArray(capabilities.input) ? capabilities.input : [];
			const reasoning =
				isRecord(capabilities.reasoning) && capabilities.reasoning.supported === true;
			const limit = isRecord(model.limit) ? model.limit : {};
			const contextWindow = positive(limit.context);
			const maxOutputTokens = positive(limit.output);
			return [
				{
					modelId,
					name: typeof model.name === "string" && model.name.trim() ? model.name : modelId,
					...(reasoning ? { reasoning: true } : {}),
					...(input.includes("image") ? { attachments: true } : {}),
					...(contextWindow ? { contextWindow } : {}),
					...(maxOutputTokens ? { maxOutputTokens } : {}),
				},
			];
		}),
	};
	const parsed = customAiProviderSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}

/**
 * What to send `kilocode.settings` so the saved entry becomes exactly `next`:
 * it sets leaves and deletes on `null`, so every object key `existing` has and
 * `next` lacks is sent as `null`. Arrays and scalars are replaced whole.
 */
export function withCustomProviderDeletions(existing: unknown, next: KiloProviderEntry): unknown {
	return withDeletions(existing, next);
}

function withDeletions(existing: unknown, next: unknown): unknown {
	if (!isRecord(existing) || !isRecord(next)) return next;
	const patch: AnyRecord = {};
	for (const key of Object.keys(existing)) if (!(key in next)) patch[key] = null;
	for (const [key, value] of Object.entries(next)) patch[key] = withDeletions(existing[key], value);
	return patch;
}
