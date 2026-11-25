import type { IntegrationInfo, ModelInfo as KiloModelInfo } from "@kilocode/client";

import {
	KILO_AI_PROVIDER_ID,
	modelKey,
	type AiProvider,
	type ModelInfo,
	type ModelRef,
} from "../../contracts";
import { isCustomProviderPackage } from "./custom-ai-provider";
import type { KiloProviderAnswers, KiloSettings } from "./kilo-models-client";

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
	readonly answers: KiloProviderAnswers;
	readonly settings: KiloSettings;
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

function configEntry(settings: KiloSettings, id: string): Record<string, unknown> | undefined {
	const entry = settings.providers?.[id];
	return isRecord(entry) ? entry : undefined;
}

function isCustom(settings: KiloSettings, id: string): boolean {
	return isCustomProviderPackage(configEntry(settings, id)?.package);
}

/** How Kilo has a provider connected: a stored credential, environment variables, or its config. */
type KiloSource = "api" | "env" | "config";

function isMcp(integration: IntegrationInfo): boolean {
	return integration.metadata?.source === "mcp";
}

function envNames(integration: IntegrationInfo | undefined): string[] {
	return (integration?.methods ?? []).flatMap((method) =>
		method.type === "env" ? method.names : [],
	);
}

function kiloSourceOf(integration: IntegrationInfo | undefined, usable: boolean) {
	const connections = integration?.connections ?? [];
	if (connections.some((connection) => connection.type === "credential")) return "api";
	if (connections.some((connection) => connection.type === "env")) return "env";
	return usable ? "config" : undefined;
}

/** Whether a key is stored for the provider's integration. */
export function hasStoredKey(answers: KiloProviderAnswers, aiProviderId: string): boolean {
	const integration = answers.integrations.find(({ id }) => id === aiProviderId);
	return (integration?.connections ?? []).some(
		(connection) => connection.type === "credential" && connection.method === "key",
	);
}

function sourceOf(
	id: string,
	kiloSource: KiloSource | undefined,
	input: AiProviderListInput,
): AiProvider["source"] {
	if (id === KILO_AI_PROVIDER_ID) return "kilo";
	if (input.contributed.has(id)) return "plugin";
	if (isCustom(input.settings, id)) return "custom";
	return kiloSource;
}

interface ProviderRow {
	readonly id: string;
	readonly name: string;
	readonly source?: KiloSource | undefined;
	readonly env?: readonly string[];
}

function row(provider: ProviderRow, connected: boolean, input: AiProviderListInput): AiProvider {
	const source = sourceOf(provider.id, provider.source, input);
	const env = [...(provider.env ?? [])];
	// A provider lists a few env names; a Set would cost more.
	// react-doctor-disable-next-line react-doctor/js-set-map-lookups
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
function unlisted(id: string, input: AiProviderListInput): ProviderRow {
	const configured = configEntry(input.settings, id)?.name;
	const configuredName = typeof configured === "string" ? configured.trim() : "";
	const popularName = POPULAR_AI_PROVIDERS[id];
	const name = configuredName || popularName || id;
	if (popularName && !isCustom(input.settings, id)) return { id, name, source: "api" };
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

function positiveInteger(value: number | undefined): number | undefined {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegative(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Kilo's model selection (`"p/m"`, `"p/m#variant"` or `{ providerID, model }`) as a model ref. */
function configuredModelOf(selection: unknown): ModelRef | undefined {
	if (isRecord(selection)) {
		const { providerID, model } = selection;
		return typeof providerID === "string" && providerID && typeof model === "string" && model
			? { aiProviderId: providerID, modelId: model }
			: undefined;
	}
	if (typeof selection !== "string") return undefined;
	const key = selection.split("#")[0]!;
	const slash = key.indexOf("/");
	if (slash <= 0 || slash === key.length - 1) return undefined;
	return { aiProviderId: key.slice(0, slash), modelId: key.slice(slash + 1) };
}

function isFreeKiloModel(model: KiloModelInfo): boolean {
	return (
		model.providerID === KILO_AI_PROVIDER_ID &&
		model.cost.length > 0 &&
		model.cost.every((cost) => cost.input === 0 && cost.output === 0)
	);
}

/**
 * Kilo models carry no reasoning flag; Kilo builds reasoning levels as
 * variants from the model's reasoning capability, so a model with variants reasons.
 */
function modelInfo(model: KiloModelInfo): ModelInfo {
	const contextWindow = positiveInteger(model.limit.context);
	const maxOutputTokens = positiveInteger(model.limit.output);
	const outputPricePerMillion = nonNegative(model.cost[0]?.output);
	return {
		aiProviderId: model.providerID,
		modelId: model.id,
		name: displayModelName(model.name),
		variants: model.variants.map((variant) => variant.id),
		...(contextWindow ? { contextWindow } : {}),
		...(maxOutputTokens ? { maxOutputTokens } : {}),
		attachments: model.capabilities.input.includes("image"),
		reasoning: model.variants.length > 0,
		free: isFreeKiloModel(model),
		...(outputPricePerMillion !== undefined ? { outputPricePerMillion } : {}),
		byok: false,
	};
}

/**
 * Kilo's AI providers as the contract's AI providers and models. Kilo names
 * every AI provider it knows as an integration (MCP servers are integrations
 * too, and left out) with how it is connected; `provider.list` holds the
 * usable (connected) ones and `model.list` their models. Listed are every
 * provider Kilo knows, popular ones to connect, and custom ones in the config
 * Kilo couldn't load (so they can be edited); models only of connected
 * providers, enabled ones only; defaults only for connected providers.
 */
export function mapAiProviderList(input: AiProviderListInput): AiProviderListState {
	const { answers } = input;
	const integrations = new Map(
		answers.integrations
			.filter((integration) => !isMcp(integration))
			.map((integration) => [integration.id, integration]),
	);
	const usable = new Map(answers.providers.map((provider) => [provider.id, provider]));
	const aiProviders: Record<string, AiProvider> = {};
	const models: Record<string, ModelInfo> = {};

	for (const id of new Set([...integrations.keys(), ...usable.keys()])) {
		const provider = usable.get(id);
		const integration = integrations.get(provider?.integrationID ?? id) ?? integrations.get(id);
		aiProviders[id] = row(
			{
				id,
				name: provider?.name ?? integration?.name ?? id,
				source: kiloSourceOf(integration, provider !== undefined),
				env: envNames(integration),
			},
			provider !== undefined,
			input,
		);
	}
	for (const model of answers.models) {
		if (!model.enabled || !usable.has(model.providerID)) continue;
		const info = modelInfo(model);
		models[modelKey(info)] = info;
	}
	for (const id of Object.keys(POPULAR_AI_PROVIDERS)) {
		aiProviders[id] ??= row(unlisted(id, input), false, input);
	}
	for (const id of Object.keys(input.settings.providers ?? {})) {
		if (isCustom(input.settings, id)) aiProviders[id] ??= row(unlisted(id, input), false, input);
	}
	const fallback = answers.defaultModel;
	const defaults =
		fallback && usable.has(fallback.providerID) ? { [fallback.providerID]: fallback.id } : {};
	const configuredModel = configuredModelOf(input.settings.model);
	return { aiProviders, models, defaults, ...(configuredModel ? { configuredModel } : {}) };
}
