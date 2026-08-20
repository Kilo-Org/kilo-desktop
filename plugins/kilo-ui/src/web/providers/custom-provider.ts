import { z } from "zod";

export const KILO_PROVIDER_ID = "kilo";

export const CUSTOM_PROVIDER_PACKAGES = [
	"@ai-sdk/openai-compatible",
	"@ai-sdk/openai",
	"@ai-sdk/anthropic",
] as const;

export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[number];

export const CUSTOM_PROVIDER_PACKAGE: CustomProviderPackage = "@ai-sdk/openai-compatible";

export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

export const POPULAR_PROVIDER_IDS = [
	KILO_PROVIDER_ID,
	"anthropic",
	"deepseek",
	"openai",
	"google",
	"openrouter",
	"vercel",
] as const;

const INVALID_PROVIDER_ID = "Invalid provider ID";
const INVALID_BASE_URL = "Base URL must start with http:// or https://";

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
	return CUSTOM_PROVIDER_PACKAGES.includes(value as CustomProviderPackage);
}

export const ProviderIDSchema = z.string().trim().regex(PROVIDER_ID_PATTERN, INVALID_PROVIDER_ID);

const ModalitySchema = z.enum(["text", "audio", "image", "video", "pdf"]);

const ModelModalitiesSchema = z.object({
	input: z.array(ModalitySchema).optional(),
	output: z.array(ModalitySchema).optional(),
});

export type ModelModalities = z.infer<typeof ModelModalitiesSchema>;

export const CustomProviderConfigSchema = z
	.object({
		npm: z.enum(CUSTOM_PROVIDER_PACKAGES).default(CUSTOM_PROVIDER_PACKAGE),
		name: z.string().trim().min(1).max(200),
		options: z
			.object({
				baseURL: z
					.string()
					.trim()
					.url()
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
						modalities: ModelModalitiesSchema.optional(),
					})
					.strict(),
			)
			.refine((value) => Object.keys(value).length > 0, "At least one model is required"),
	})
	.strict();

export type SanitizedProviderConfig = {
	npm: CustomProviderPackage;
	name: string;
	options: {
		baseURL: string;
		headers?: Record<string, string>;
	};
	models: Record<
		string,
		{
			name: string;
			reasoning?: true;
			modalities?: ModelModalities;
		}
	>;
};

export type CustomProviderAuthChange =
	| { mode: "preserve" }
	| { mode: "clear" }
	| { mode: "set"; key: string };

export const MASKED_CUSTOM_PROVIDER_KEY = "********";

type Issue = { error: string };

function fail(error: string): Issue {
	return { error };
}

export function validateProviderID(providerID: string): { value: string } | Issue {
	const result = ProviderIDSchema.safeParse(providerID);
	if (result.success) return { value: result.data };
	return fail(result.error.issues[0]?.message ?? INVALID_PROVIDER_ID);
}

export function resolveCustomProviderAuth(
	apiKey: string | undefined,
	changed: boolean,
): CustomProviderAuthChange {
	const key = apiKey?.trim();
	if (!changed) return { mode: "preserve" };
	if (key) return { mode: "set", key };
	return { mode: "clear" };
}

export function resolveCustomProviderKey(auth: "api" | "oauth" | "wellknown" | undefined) {
	if (auth !== "api") return "";
	return MASKED_CUSTOM_PROVIDER_KEY;
}

function stripSecrets(provider: unknown): unknown {
	if (!provider || typeof provider !== "object" || Array.isArray(provider)) return provider;
	const record = provider as Record<string, unknown>;
	const options = record.options;
	if (!options || typeof options !== "object" || Array.isArray(options)) return provider;
	const rest = Object.fromEntries(
		Object.entries(options as Record<string, unknown>).filter(([key]) => key !== "apiKey"),
	);
	return { ...record, options: rest };
}

export function normalizeCustomProviderConfig(
	config: z.output<typeof CustomProviderConfigSchema>,
): SanitizedProviderConfig {
	const headers = config.options.headers
		? Object.fromEntries(
				Object.entries(config.options.headers)
					.map(([key, value]) => [key.trim(), value.trim()] as const)
					.filter(([key, value]) => key.length > 0 && value.length > 0),
			)
		: undefined;

	return {
		npm: config.npm,
		name: config.name.trim(),
		options: {
			baseURL: config.options.baseURL.trim(),
			...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		},
		models: Object.fromEntries(
			Object.entries(config.models).map(([id, model]) => [
				id.trim(),
				{
					name: model.name.trim(),
					...(model.reasoning ? { reasoning: true as const } : {}),
					...(model.modalities ? { modalities: model.modalities } : {}),
				},
			]),
		),
	};
}

export function sanitizeCustomProviderConfig(
	provider: unknown,
): { value: SanitizedProviderConfig } | Issue {
	const result = CustomProviderConfigSchema.safeParse(stripSecrets(provider));
	if (!result.success) {
		return fail(result.error.issues[0]?.message ?? "Invalid custom provider config");
	}
	return { value: normalizeCustomProviderConfig(result.data) };
}

type AnyRecord = Record<string, unknown>;
type ProviderPatch = Omit<SanitizedProviderConfig, "models"> & {
	models: Record<
		string,
		null | {
			name: string;
			reasoning?: true | null;
			modalities?: ModelModalities | null;
		}
	>;
};

function isRecord(value: unknown): value is AnyRecord {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * CLI `config.update` deep-merges. Null sentinels delete models / flags that
 * existed on disk but are gone from the next sanitized block.
 */
export function withCustomProviderDeletions(
	existing: unknown,
	next: SanitizedProviderConfig,
): SanitizedProviderConfig {
	if (!isRecord(existing)) return next;
	const oldModels = isRecord(existing.models) ? existing.models : {};
	const patched: ProviderPatch["models"] = { ...next.models };

	for (const id of Object.keys(oldModels)) {
		if (!(id in patched)) {
			patched[id] = null;
			continue;
		}
		const oldModel = oldModels[id];
		const newModel = patched[id];
		if (!isRecord(oldModel) || !isRecord(newModel)) continue;
		patched[id] = {
			...newModel,
			...(oldModel.reasoning !== undefined && newModel.reasoning === undefined
				? { reasoning: null }
				: {}),
			...(oldModel.modalities !== undefined && newModel.modalities === undefined
				? { modalities: null }
				: {}),
		};
	}

	return { ...next, models: patched } as SanitizedProviderConfig;
}
