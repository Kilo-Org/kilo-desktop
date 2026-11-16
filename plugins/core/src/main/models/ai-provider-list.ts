import {
	KILO_AI_PROVIDER_ID,
	modelKey,
	type AiProvider,
	type ModelInfo,
	type ModelRef,
} from "../../contracts";
import { isCustomProviderPackage } from "./custom-ai-provider";
import type {
	KiloGlobalConfig,
	KiloProvider,
	KiloProviderList,
	KiloProviderModel,
} from "./kilo-models-client";

/** AI providers offered for connecting even when Kilo's list omits them (e.g. after a disconnect). */
export const POPULAR_AI_PROVIDERS: Readonly<Record<string, string>> = {
	anthropic: "Anthropic",
	deepseek: "DeepSeek",
	openai: "OpenAI",
	google: "Google",
	openrouter: "OpenRouter",
	vercel: "Vercel",
};

/** Credential-chain variables Kilo reads for Amazon Bedrock but doesn't list. */
const EXTRA_ENV: Readonly<Record<string, readonly string[]>> = {
	"amazon-bedrock": ["AWS_PROFILE", "AWS_SSO_START_URL"],
};

export interface AiProviderListInput {
	readonly list: KiloProviderList;
	readonly config: KiloGlobalConfig;
	/** AI providers contributed by plugins (`kilo.core/ai-provider`). */
	readonly contributed: ReadonlySet<string>;
}

export interface AiProviderListState {
	readonly aiProviders: Record<string, AiProvider>;
	readonly models: Record<string, ModelInfo>;
	readonly defaults: Record<string, string>;
	readonly configuredModel?: ModelRef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function configEntry(config: KiloGlobalConfig, id: string): Record<string, unknown> | undefined {
	const entry = config.provider?.[id];
	return isRecord(entry) ? entry : undefined;
}

function isCustom(config: KiloGlobalConfig, id: string): boolean {
	return isCustomProviderPackage(configEntry(config, id)?.npm);
}

/**
 * Kilo's own source, from the user's point of view. Kilo calls providers it
 * autoloads from a credential chain (Amazon Bedrock via `AWS_PROFILE`)
 * "custom"; they come back after `auth.remove`, so they count as environment.
 */
function sourceOf(
	id: string,
	kiloSource: KiloProvider["source"],
	input: AiProviderListInput,
): AiProvider["source"] {
	if (id === KILO_AI_PROVIDER_ID) return "kilo";
	if (input.contributed.has(id)) return "plugin";
	if (isCustom(input.config, id)) return "custom";
	if (kiloSource === "custom") return "env";
	return kiloSource;
}

function row(
	provider: Pick<KiloProvider, "id" | "name" | "source" | "env">,
	connected: boolean,
	input: AiProviderListInput,
): AiProvider {
	const source = sourceOf(provider.id, provider.source, input);
	const env = [...(provider.env ?? [])];
	for (const name of EXTRA_ENV[provider.id] ?? []) if (!env.includes(name)) env.push(name);
	return {
		id: provider.id,
		name: provider.name,
		connected,
		...(source ? { source } : {}),
		env,
		canDisconnect: source === "custom" || source === "api",
	};
}

/** A provider Kilo didn't list, described from the config or the popular names. */
function unlisted(
	id: string,
	input: AiProviderListInput,
): Pick<KiloProvider, "id" | "name" | "source"> {
	const configured = configEntry(input.config, id)?.name;
	const configuredName = typeof configured === "string" ? configured.trim() : "";
	const popularName = POPULAR_AI_PROVIDERS[id];
	const name = configuredName || popularName || id;
	if (popularName && !isCustom(input.config, id)) return { id, name, source: "api" };
	return { id, name };
}

const PRICE_MARKER = /\s*\((?:\$+\+?|free)\)/gi;

/**
 * Gateway names embed price hints like "($$$$)" or "(free)"; pickers show
 * cost and free on their own, so drop them (keeping the raw name if nothing is left).
 */
function displayModelName(name: string): string {
	return name.replace(PRICE_MARKER, "").trim() || name;
}

/** Named variants (reasoning levels), or the effort values of older payloads. */
function variantsOf(model: KiloProviderModel): string[] {
	const variants = Object.keys(model.variants ?? {});
	if (variants.length > 0) return variants;
	return [...(model.reasoning_options?.find((option) => option.type === "effort")?.values ?? [])];
}

function positiveInteger(value: number | undefined): number | undefined {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegative(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** `<aiProviderId>/<modelId>` as a model ref; undefined when it isn't one. */
function parseModelKey(key: string | undefined): ModelRef | undefined {
	const slash = key?.indexOf("/") ?? -1;
	if (!key || slash <= 0 || slash === key.length - 1) return undefined;
	return { aiProviderId: key.slice(0, slash), modelId: key.slice(slash + 1) };
}

function modelInfo(aiProviderId: string, model: KiloProviderModel): ModelInfo {
	const contextWindow = positiveInteger(model.limit?.context);
	const maxOutputTokens = positiveInteger(model.limit?.output);
	const recommendedIndex =
		model.recommendedIndex !== undefined && Number.isInteger(model.recommendedIndex)
			? nonNegative(model.recommendedIndex)
			: undefined;
	const outputPricePerMillion = nonNegative(model.cost?.output);
	const description = model.options?.description?.trim();
	return {
		aiProviderId,
		modelId: model.id,
		name: displayModelName(model.name),
		variants: variantsOf(model),
		...(contextWindow ? { contextWindow } : {}),
		...(maxOutputTokens ? { maxOutputTokens } : {}),
		attachments: model.capabilities?.attachment === true,
		reasoning: model.capabilities?.reasoning === true,
		free: model.isFree === true,
		...(recommendedIndex !== undefined ? { recommendedIndex } : {}),
		...(description ? { description } : {}),
		...(outputPricePerMillion !== undefined ? { outputPricePerMillion } : {}),
		byok: aiProviderId === KILO_AI_PROVIDER_ID && model.hasUserByokAvailable === true,
	};
}

/**
 * Kilo's provider list as the contract's AI providers and models: every
 * listed AI provider, plus connected ones the list omits, popular ones to
 * connect, and custom ones in the config Kilo couldn't load (so they can be
 * edited); models only of connected AI providers.
 */
export function mapAiProviderList(input: AiProviderListInput): AiProviderListState {
	const connected = new Set(input.list.connected);
	const aiProviders: Record<string, AiProvider> = {};
	const models: Record<string, ModelInfo> = {};

	for (const provider of input.list.all) {
		const isConnected = connected.has(provider.id);
		aiProviders[provider.id] = row(provider, isConnected, input);
		if (!isConnected) continue;
		for (const model of Object.values(provider.models)) {
			const info = modelInfo(provider.id, model);
			models[modelKey(info)] = info;
		}
	}
	for (const id of connected) {
		aiProviders[id] ??= row(unlisted(id, input), true, input);
	}
	for (const id of Object.keys(POPULAR_AI_PROVIDERS)) {
		aiProviders[id] ??= row(unlisted(id, input), false, input);
	}
	for (const id of Object.keys(input.config.provider ?? {})) {
		if (isCustom(input.config, id)) aiProviders[id] ??= row(unlisted(id, input), false, input);
	}
	const defaults = Object.fromEntries(
		Object.entries(input.list.default ?? {}).filter(([id]) => connected.has(id)),
	);
	const configuredModel = parseModelKey(input.config.model);
	return { aiProviders, models, defaults, ...(configuredModel ? { configuredModel } : {}) };
}
