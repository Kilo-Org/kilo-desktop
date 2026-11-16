import {
	CUSTOM_AI_PROVIDER_API_FORMATS,
	customAiProviderSchema,
	KILO_AI_PROVIDER_ID,
	type CustomAiProvider,
	type CustomAiProviderApiFormat,
} from "@kilo-desktop/plugin-core/contracts";

/**
 * The custom AI provider form's model, its validation and its conversion to
 * and from `kilo.core/models`' `CustomAiProvider`. kilo.core validates again
 * and owns Kilo's config shape; this only catches what the person can fix
 * before saving.
 */

export const DEFAULT_API_FORMAT: CustomAiProviderApiFormat = "openai-compatible";

const API_FORMAT_LABELS: Readonly<Record<CustomAiProviderApiFormat, string>> = {
	"openai-compatible": "OpenAI Compatible",
	"openai-responses": "OpenAI Responses",
	"anthropic-messages": "Anthropic Messages",
};

export const API_FORMAT_ITEMS = CUSTOM_AI_PROVIDER_API_FORMATS.map((value) => ({
	value,
	label: API_FORMAT_LABELS[value],
}));

export interface HeaderRow {
	readonly rowID: string;
	readonly key: string;
	readonly value: string;
}

export interface ModelRow {
	readonly rowID: string;
	readonly id: string;
	readonly reasoning: boolean;
	readonly supportsImages: boolean;
	/** Kept from the saved model so an edit doesn't drop them; new models are named by their id. */
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxOutputTokens?: number;
}

export interface CustomProviderFormState {
	readonly name: string;
	readonly apiFormat: CustomAiProviderApiFormat;
	readonly baseURL: string;
	readonly apiKey: string;
	readonly headers: readonly HeaderRow[];
	readonly models: readonly ModelRow[];
}

const INVALID_BASE_URL = "Base URL must start with http:// or https://";

/** The first value seen twice (trimmed, optionally case-insensitively), or undefined. */
export function findDuplicate(values: readonly string[], insensitive = false): string | undefined {
	const seen = new Set<string>();
	for (const value of values) {
		const key = insensitive ? value.trim().toLowerCase() : value.trim();
		if (!key) continue;
		if (seen.has(key)) return key;
		seen.add(key);
	}
	return undefined;
}

/** A stable id from the display name that no existing AI provider (or Kilo's gateway) uses. */
export function generateProviderID(name: string, blockedIds: readonly string[]): string {
	const normalized = name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const base = normalized || "custom-provider";
	const blocked = new Set([...blockedIds, KILO_AI_PROVIDER_ID]);
	if (!blocked.has(base)) return base;

	let suffix = 2;
	while (blocked.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

export function validateHeaders(headers: readonly HeaderRow[]): string | null {
	if (headers.some((row) => !row.key.trim() || !row.value.trim())) {
		return "Header name and value are both required";
	}
	const duplicate = findDuplicate(
		headers.map((row) => row.key),
		true,
	);
	return duplicate ? `Header "${duplicate}" is duplicated` : null;
}

export function emptyForm(): CustomProviderFormState {
	return {
		name: "",
		apiFormat: DEFAULT_API_FORMAT,
		baseURL: "",
		apiKey: "",
		headers: [],
		models: [],
	};
}

/** The form for editing a saved provider; its key field starts empty (blank keeps the stored key). */
export function formFromCustomAiProvider(provider: CustomAiProvider): CustomProviderFormState {
	return {
		name: provider.name,
		apiFormat: provider.apiFormat ?? DEFAULT_API_FORMAT,
		baseURL: provider.baseUrl,
		apiKey: "",
		headers: Object.entries(provider.headers ?? {}).map(([key, value]) => ({
			rowID: crypto.randomUUID(),
			key,
			value,
		})),
		models: provider.models.map((model) => ({
			rowID: crypto.randomUUID(),
			id: model.modelId,
			name: model.name,
			reasoning: model.reasoning === true,
			supportsImages: model.attachments === true,
			...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
			...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
		})),
	};
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * The provider to save from a filled-in form, or what to fix first. `apiKey`
 * is passed through as the contract reads it: undefined keeps the stored key,
 * empty removes it.
 */
export function toCustomAiProvider(
	form: CustomProviderFormState,
	input: { readonly aiProviderId: string; readonly apiKey: string | undefined },
): { value: CustomAiProvider } | { error: string } {
	const name = form.name.trim();
	if (!name) return { error: "Enter a provider name" };
	const baseUrl = form.baseURL.trim();
	if (!isHttpUrl(baseUrl)) return { error: INVALID_BASE_URL };
	const models = form.models.filter((model) => model.id.trim());
	if (models.length === 0) return { error: "At least one model is required" };
	const headers = Object.fromEntries(
		form.headers
			.map((row) => [row.key.trim(), row.value.trim()] as const)
			.filter(([key, value]) => key && value),
	);
	const provider: CustomAiProvider = {
		aiProviderId: input.aiProviderId,
		name,
		baseUrl,
		apiFormat: form.apiFormat,
		...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
		models: models.map((model) => ({
			modelId: model.id.trim(),
			name: model.name ?? model.id.trim(),
			reasoning: model.reasoning,
			attachments: model.supportsImages,
			...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
			...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
		})),
	};
	const parsed = customAiProviderSchema.safeParse(provider);
	if (!parsed.success)
		return { error: parsed.error.issues[0]?.message ?? "Invalid custom AI provider" };
	return { value: provider };
}
