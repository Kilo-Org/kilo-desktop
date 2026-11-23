import type { IntegrationInfo, ModelInfo, ProviderInfo } from "@kilocode/client";

import { KILO_AI_PROVIDER_ID } from "../../contracts";
import type { KiloProvider, KiloProviderList, KiloProviderModel } from "./kilo-models-client";

/**
 * Kilo v2's provider answers folded into the v1 `provider.list` shape the
 * models area maps (`ai-provider-list.ts`), so that mapping stays as in v1.
 *
 * v2 splits v1's one answer: `integration.list` names every AI provider Kilo
 * knows and how each is connected (stored credentials, environment
 * variables); `provider.list` and `model.list` hold only the usable ones and
 * their enabled models; `model.default` is one default for the whole location.
 * A provider is connected when `provider.list` has it. MCP servers are
 * integrations too and are left out.
 */

export interface KiloV2ProviderAnswers {
	readonly integrations: readonly IntegrationInfo[];
	readonly providers: readonly ProviderInfo[];
	readonly models: readonly ModelInfo[];
	readonly defaultModel: ModelInfo | null;
}

/** Stands in for a stored key: v1 sent the key itself; only its presence is read. */
export const STORED_KEY_MARKER = "stored";

function isMcp(integration: IntegrationInfo): boolean {
	return integration.metadata?.source === "mcp";
}

function envNames(integration: IntegrationInfo): string[] {
	return integration.methods.flatMap((method) => (method.type === "env" ? method.names : []));
}

/** v1's source, from how v2 says the provider is connected. */
function sourceOf(
	integration: IntegrationInfo | undefined,
	usable: boolean,
): KiloProvider["source"] | undefined {
	const connections = integration?.connections ?? [];
	if (connections.some((connection) => connection.type === "credential")) return "api";
	if (connections.some((connection) => connection.type === "env")) return "env";
	return usable ? "config" : undefined;
}

function hasStoredKey(integration: IntegrationInfo | undefined): boolean {
	return (integration?.connections ?? []).some(
		(connection) => connection.type === "credential" && connection.method === "key",
	);
}

function isFreeKiloModel(model: ModelInfo): boolean {
	return (
		model.providerID === KILO_AI_PROVIDER_ID &&
		model.cost.length > 0 &&
		model.cost.every((cost) => cost.input === 0 && cost.output === 0)
	);
}

/**
 * v2 models carry no reasoning flag; it builds reasoning levels as variants
 * from the model's reasoning capability, so a model with variants reasons.
 */
function toKiloModel(model: ModelInfo): KiloProviderModel {
	const output = model.cost[0]?.output;
	return {
		id: model.id,
		name: model.name,
		providerID: model.providerID,
		variants: Object.fromEntries(
			model.variants.map((variant) => [variant.id, variant.settings ?? {}]),
		),
		limit: { context: model.limit.context, output: model.limit.output },
		capabilities: {
			reasoning: model.variants.length > 0,
			attachment: model.capabilities.input.includes("image"),
		},
		isFree: isFreeKiloModel(model),
		...(output === undefined ? {} : { cost: { output } }),
	};
}

export function toKiloProviderList(answers: KiloV2ProviderAnswers): KiloProviderList {
	const integrations = new Map(
		answers.integrations
			.filter((integration) => !isMcp(integration))
			.map((integration) => [integration.id, integration]),
	);
	const usable = new Map(answers.providers.map((provider) => [provider.id, provider]));
	const modelsByProvider = new Map<string, Record<string, KiloProviderModel>>();
	for (const model of answers.models) {
		if (!model.enabled) continue;
		const models = modelsByProvider.get(model.providerID) ?? {};
		models[model.id] = toKiloModel(model);
		modelsByProvider.set(model.providerID, models);
	}

	const ids = new Set([...integrations.keys(), ...usable.keys()]);
	const all = [...ids].map((id): KiloProvider => {
		const provider = usable.get(id);
		const integration = integrations.get(provider?.integrationID ?? id) ?? integrations.get(id);
		const source = sourceOf(integration, provider !== undefined);
		return {
			id,
			name: provider?.name ?? integration?.name ?? id,
			...(source ? { source } : {}),
			env: integration ? envNames(integration) : [],
			...(hasStoredKey(integration) ? { key: STORED_KEY_MARKER } : {}),
			models: modelsByProvider.get(id) ?? {},
		};
	});
	const defaultModel = answers.defaultModel;
	return {
		all,
		connected: [...usable.keys()],
		...(defaultModel ? { default: { [defaultModel.providerID]: defaultModel.id } } : {}),
	};
}
