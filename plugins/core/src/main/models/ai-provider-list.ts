import {
	KILO_AI_PROVIDER_ID,
	modelKey,
	type AiProvider,
	type ModelInfo,
	type ModelRef,
} from "../../contracts";
import { isCustomProviderPackage } from "./custom-ai-provider";
import type {
	KiloCatalog,
	KiloGatewayModel,
	KiloGlobalConfig,
	KiloIntegration,
	KiloModel,
} from "./kilo-models-client";

/** AI providers offered for connecting even when nothing connects them yet. */
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
	readonly catalog: KiloCatalog;
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
	const entry = config.providers?.[id];
	return isRecord(entry) ? entry : undefined;
}

function isCustom(config: KiloGlobalConfig, id: string): boolean {
	return isCustomProviderPackage(configEntry(config, id)?.package);
}

/** Where an AI provider comes from, from the user's point of view. */
function sourceOf(
	id: string,
	integration: KiloIntegration | undefined,
	input: AiProviderListInput,
): AiProvider["source"] {
	if (id === KILO_AI_PROVIDER_ID) return "kilo";
	if (input.contributed.has(id)) return "plugin";
	if (isCustom(input.config, id)) return "custom";
	const connections = integration?.connections ?? [];
	if (connections.some((connection) => connection.type === "credential")) return "api";
	if (connections.some((connection) => connection.type === "env")) return "env";
	return integration ? undefined : "config";
}

function envOf(id: string, integration: KiloIntegration | undefined): string[] {
	const env = (integration?.methods ?? []).flatMap((method) =>
		method.type === "env" ? [...(method.names ?? [])] : [],
	);
	const listed = new Set(env);
	return [...env, ...(EXTRA_ENV[id] ?? []).filter((name) => !listed.has(name))];
}

function row(
	id: string,
	name: string,
	connected: boolean,
	integration: KiloIntegration | undefined,
	input: AiProviderListInput,
): AiProvider {
	const source = sourceOf(id, integration, input);
	return {
		id,
		name,
		connected,
		...(source ? { source } : {}),
		env: envOf(id, integration),
		canDisconnect: source === "custom" || source === "api",
	};
}

/** A provider Kilo hasn't enabled, named from its integration, the config, or the popular names. */
function unlistedName(
	id: string,
	integration: KiloIntegration | undefined,
	input: AiProviderListInput,
) {
	const configured = configEntry(input.config, id)?.name;
	const configuredName = typeof configured === "string" ? configured.trim() : "";
	return configuredName || integration?.name || POPULAR_AI_PROVIDERS[id] || id;
}

const PRICE_MARKER = /\s*\((?:\$+\+?|free)\)/gi;

/**
 * Gateway names embed price hints like "($$$$)" or "(free)"; pickers show
 * cost and free on their own, so drop them (keeping the raw name if nothing is left).
 */
function displayModelName(name: string): string {
	return name.replace(PRICE_MARKER, "").trim() || name;
}

function positiveInteger(value: number | undefined): number | undefined {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegative(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A config model selection, `<providerID>/<id>` or `{ providerID, id }`, as a model ref. */
function parseModelSelection(value: unknown): ModelRef | undefined {
	if (isRecord(value)) {
		const { providerID, id } = value;
		return typeof providerID === "string" && providerID && typeof id === "string" && id
			? { aiProviderId: providerID, modelId: id }
			: undefined;
	}
	if (typeof value !== "string") return undefined;
	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return undefined;
	return { aiProviderId: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

/** The base tier's price: the one without a context tier. */
function basePrice(model: KiloModel) {
	return model.cost.find((cost) => cost.tier === undefined) ?? model.cost[0];
}

function modelInfo(model: KiloModel, gateway: KiloGatewayModel | undefined): ModelInfo {
	const isKilo = model.providerID === KILO_AI_PROVIDER_ID;
	const contextWindow = positiveInteger(model.limit.context);
	const maxOutputTokens = positiveInteger(model.limit.output);
	const recommendedIndex =
		gateway?.recommendedIndex !== undefined && Number.isInteger(gateway.recommendedIndex)
			? nonNegative(gateway.recommendedIndex)
			: undefined;
	const price = basePrice(model);
	const outputPricePerMillion = nonNegative(price?.output);
	const description = gateway?.description?.trim();
	const variants = model.variants.map((variant) => variant.id).filter((id) => id !== "none");
	const free = gateway
		? gateway.isFree
		: isKilo && price !== undefined && price.input === 0 && price.output === 0;
	return {
		aiProviderId: model.providerID,
		modelId: model.id,
		name: displayModelName(model.name),
		variants,
		...(contextWindow ? { contextWindow } : {}),
		...(maxOutputTokens ? { maxOutputTokens } : {}),
		attachments: model.capabilities.input.some((input) => input !== "text"),
		reasoning: gateway?.reasoning ?? variants.length > 0,
		free,
		...(recommendedIndex !== undefined ? { recommendedIndex } : {}),
		...(description ? { description } : {}),
		...(outputPricePerMillion !== undefined ? { outputPricePerMillion } : {}),
		byok: isKilo && gateway?.hasUserByokAvailable === true,
	};
}

/**
 * Kilo v2's catalog as the contract's AI providers and models: every provider
 * Kilo has enabled (connected), plus popular ones to connect and custom ones
 * in the user's config Kilo couldn't enable (so they can be edited); models
 * only of connected providers, and only those Kilo enables.
 */
export function mapAiProviderList(input: AiProviderListInput): AiProviderListState {
	const { catalog } = input;
	const integrations = new Map(
		catalog.integrations.map((integration) => [integration.id, integration]),
	);
	const gateway = new Map(catalog.gateway.map((entry) => [entry.id, entry]));
	const aiProviders: Record<string, AiProvider> = {};
	const models: Record<string, ModelInfo> = {};

	for (const provider of catalog.providers) {
		if (provider.activation === "disabled") continue;
		const integration = integrations.get(provider.integrationID ?? provider.id);
		aiProviders[provider.id] = row(provider.id, provider.name, true, integration, input);
	}
	for (const model of catalog.models) {
		if (!model.enabled || !aiProviders[model.providerID]) continue;
		const info = modelInfo(
			model,
			model.providerID === KILO_AI_PROVIDER_ID ? gateway.get(model.id) : undefined,
		);
		models[modelKey(info)] = info;
	}
	const unlisted = [
		...Object.keys(POPULAR_AI_PROVIDERS),
		...Object.keys(input.config.providers ?? {}).filter((id) => isCustom(input.config, id)),
	];
	for (const id of unlisted) {
		if (aiProviders[id]) continue;
		const integration = integrations.get(id);
		aiProviders[id] = row(id, unlistedName(id, integration, input), false, integration, input);
	}

	const defaults: Record<string, string> = {};
	const recommended = catalog.gateway.find((entry) => entry.recommended);
	if (recommended && models[`${KILO_AI_PROVIDER_ID}/${recommended.id}`]) {
		defaults[KILO_AI_PROVIDER_ID] = recommended.id;
	}
	const fallback = catalog.defaultModel;
	if (fallback && models[`${fallback.providerID}/${fallback.id}`]) {
		defaults[fallback.providerID] ??= fallback.id;
	}
	const configuredModel = parseModelSelection(input.config.model);
	return { aiProviders, models, defaults, ...(configuredModel ? { configuredModel } : {}) };
}
