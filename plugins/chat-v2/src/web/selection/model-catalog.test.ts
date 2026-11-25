import { describe, expect, it } from "vitest";

import type { AiProvider, ModelInfo, ModelsState } from "@kilo-desktop/plugin-core/contracts";

import {
	attachGatewayModelDetails,
	buildCatalogFromModels,
	isKiloGatewayProvider,
	modelRefToId,
	parseModelId,
	pickDefaultModel,
	toKiloModelRef,
	toModelRef,
} from "./model-catalog";

function aiProvider(id: string, name: string, connected = true): AiProvider {
	return { id, name, connected, env: [], canDisconnect: true };
}

function model(aiProviderId: string, modelId: string, patch: Partial<ModelInfo> = {}): ModelInfo {
	return {
		aiProviderId,
		modelId,
		name: modelId,
		variants: [],
		attachments: true,
		reasoning: false,
		free: false,
		byok: false,
		...patch,
	};
}

function state(
	aiProviders: readonly AiProvider[],
	models: readonly ModelInfo[],
	patch: Partial<Pick<ModelsState, "defaults" | "configuredModel">> = {},
): Pick<ModelsState, "aiProviders" | "models" | "defaults" | "configuredModel"> {
	return {
		aiProviders: Object.fromEntries(aiProviders.map((entry) => [entry.id, entry])),
		models: Object.fromEntries(
			models.map((entry) => [`${entry.aiProviderId}/${entry.modelId}`, entry]),
		),
		defaults: {},
		...patch,
	};
}

const ANTHROPIC = state(
	[aiProvider("anthropic", "Anthropic"), aiProvider("openai", "OpenAI", false)],
	[
		model("anthropic", "claude-sonnet", { name: "Claude Sonnet" }),
		model("anthropic", "claude-opus", { name: "Claude Opus" }),
	],
);

describe("model-catalog", () => {
	it("round-trips model ids", () => {
		expect(modelRefToId({ providerID: "anthropic", id: "claude-sonnet" })).toBe(
			"anthropic/claude-sonnet",
		);
		expect(parseModelId("anthropic/claude-sonnet")).toEqual({
			providerID: "anthropic",
			id: "claude-sonnet",
		});
		expect(parseModelId("anthropic/org/model")).toEqual({
			providerID: "anthropic",
			id: "org/model",
		});
		expect(parseModelId("bad")).toBeNull();
	});

	it("converts between kilo.core's model refs and the picker's", () => {
		expect(toKiloModelRef({ aiProviderId: "acme", modelId: "fast-1" })).toEqual({
			providerID: "acme",
			id: "fast-1",
		});
		expect(toModelRef({ providerID: "acme", id: "fast-1" })).toEqual({
			aiProviderId: "acme",
			modelId: "fast-1",
		});
	});

	it("recognizes the Kilo Gateway provider by id or name", () => {
		expect(isKiloGatewayProvider({ id: "kilo" })).toBe(true);
		expect(isKiloGatewayProvider({ id: "kilo", name: "Kilo Gateway" })).toBe(true);
		expect(isKiloGatewayProvider({ id: "other", name: "Kilo Gateway" })).toBe(true);
		expect(isKiloGatewayProvider({ id: "anthropic", name: "Anthropic" })).toBe(false);
	});

	it("lists connected AI providers and their models", () => {
		const catalog = buildCatalogFromModels(ANTHROPIC);
		expect(catalog.providers).toEqual([{ id: "anthropic", name: "Anthropic", connected: true }]);
		expect(catalog.connected).toEqual(["anthropic"]);
		expect(catalog.models.map((entry) => entry.id)).toEqual([
			"anthropic/claude-sonnet",
			"anthropic/claude-opus",
		]);
		expect(catalog.models[0]).toMatchObject({
			name: "Claude Sonnet",
			description: "Anthropic",
			providerName: "Anthropic",
			keywords: ["Anthropic", "anthropic", "claude-sonnet"],
			disabled: false,
		});
	});

	it("leaves out models of AI providers that aren't connected", () => {
		const catalog = buildCatalogFromModels(
			state([aiProvider("anthropic", "Anthropic", false)], [model("anthropic", "claude-sonnet")]),
		);
		expect(catalog.models).toEqual([]);
	});

	it("carries recommendations, descriptions, cost tiers and BYOK from kilo.core", () => {
		const catalog = buildCatalogFromModels(
			state(
				[aiProvider("kilo", "Kilo Gateway"), aiProvider("anthropic", "Anthropic")],
				[
					model("kilo", "openai/gpt-5", {
						recommendedIndex: 2,
						description: "A frontier model.",
						outputPricePerMillion: 10,
						byok: true,
					}),
					model("anthropic", "claude-sonnet", { description: "  ", byok: true }),
				],
			),
		);
		expect(catalog.models[0]).toMatchObject({
			recommendedIndex: 2,
			description: "A frontier model.",
			costTier: "high",
			hasByok: true,
		});
		expect(catalog.models[1]?.description).toBe("Anthropic");
		expect(catalog.models[1]?.hasByok).toBeUndefined();
		expect(catalog.models[1]?.costTier).toBeUndefined();
	});

	it("carries each provider's default and the configured model", () => {
		const catalog = buildCatalogFromModels(
			state([aiProvider("anthropic", "Anthropic")], [model("anthropic", "claude-sonnet")], {
				defaults: { anthropic: "claude-sonnet" },
				configuredModel: { aiProviderId: "anthropic", modelId: "claude-sonnet" },
			}),
		);
		expect(catalog.defaults).toEqual({ anthropic: "claude-sonnet" });
		expect(catalog.configuredModel).toEqual({ providerID: "anthropic", id: "claude-sonnet" });
	});

	it("carries what the account says about the gateway", () => {
		expect(buildCatalogFromModels(ANTHROPIC).providerReady).toBeUndefined();
		expect(
			buildCatalogFromModels(ANTHROPIC, { providerReady: false, organizationId: "org_1" }),
		).toMatchObject({ providerReady: false, organizationId: "org_1" });
	});

	it("maps reasoning efforts and context windows onto catalog models", () => {
		const catalog = buildCatalogFromModels(
			state(
				[aiProvider("anthropic", "Anthropic")],
				[
					model("anthropic", "claude-sonnet", {
						variants: ["low", "high", "custom"],
						contextWindow: 200_000,
					}),
				],
			),
		);
		expect(catalog.models[0]?.efforts).toEqual([
			{ id: "low", name: "Low" },
			{ id: "high", name: "High" },
			{ id: "custom", name: "Custom" },
		]);
		expect(catalog.models[0]?.contextWindow).toBe(200_000);
	});

	it("orders providers like the AI providers page: Kilo, Local, then others by name", () => {
		const catalog = buildCatalogFromModels(
			state(
				[
					aiProvider("zeta", "Zeta"),
					aiProvider("anthropic", "Anthropic"),
					aiProvider("kilo-desktop-model-server", "kilo-desktop-model-server"),
					aiProvider("kilo", "Kilo Gateway"),
				],
				[],
			),
		);
		expect(catalog.providers.map((provider) => provider.id)).toEqual([
			"kilo",
			"kilo-desktop-model-server",
			"anthropic",
			"zeta",
		]);
		expect(catalog.providers[1]?.name).toBe("Local Model Server");
	});

	it("attaches gateway details only to matching Gateway models", () => {
		const catalog = buildCatalogFromModels(
			state(
				[aiProvider("kilo", "Kilo Gateway"), aiProvider("anthropic", "Anthropic")],
				[model("kilo", "openai/gpt-5"), model("anthropic", "openai/gpt-5")],
			),
		);
		const details = { modelId: "openai/gpt-5", kiloBenchScore: 0.75 };

		const enriched = attachGatewayModelDetails(catalog, [details]);

		expect(enriched?.models[0]?.details).toEqual(details);
		expect(enriched?.models[0]?.isFree).toBeUndefined();
		expect(enriched?.models[1]?.details).toBeUndefined();
		expect(attachGatewayModelDetails(catalog, [])).toBe(catalog);
	});

	it("does not treat paid kilo-auto/* models as free; only the Gateway flag counts", () => {
		const catalog = buildCatalogFromModels(
			state(
				[aiProvider("kilo", "Kilo Gateway")],
				[
					model("kilo", "kilo-auto/efficient", { free: true }),
					model("kilo", "kilo-auto/free", { free: true }),
				],
			),
		);
		expect(catalog.models.some((entry) => entry.isFree)).toBe(false);

		const enriched = attachGatewayModelDetails(catalog, [
			{ modelId: "kilo-auto/efficient", isFree: false },
			{ modelId: "kilo-auto/free", isFree: true },
		]);
		expect(enriched?.models.filter((entry) => entry.isFree).map((entry) => entry.modelID)).toEqual([
			"kilo-auto/free",
		]);
	});

	it("prefers Auto Free, then another Kilo Auto model, then the first connected provider's default or most recommended", () => {
		const kilo = aiProvider("kilo", "Kilo Gateway");
		expect(
			pickDefaultModel(
				buildCatalogFromModels(
					state(
						[kilo],
						[
							model("kilo", "auto"),
							model("kilo", "kilo-auto/free"),
							model("kilo", "kilo-auto/frontier"),
						],
					),
				),
			),
		).toEqual({ providerID: "kilo", id: "kilo-auto/free" });
		expect(
			pickDefaultModel(
				buildCatalogFromModels(
					state(
						[kilo],
						[model("kilo", "google/gemini-3-pro-image"), model("kilo", "kilo-auto/frontier")],
					),
				),
			),
		).toEqual({ providerID: "kilo", id: "kilo-auto/frontier" });
		expect(pickDefaultModel(buildCatalogFromModels(ANTHROPIC))).toEqual({
			providerID: "anthropic",
			id: "claude-sonnet",
		});
		expect(
			pickDefaultModel(
				buildCatalogFromModels(
					state(
						[aiProvider("anthropic", "Anthropic")],
						[
							model("anthropic", "claude-opus", { name: "Claude Opus" }),
							model("anthropic", "claude-sonnet", { name: "Claude Sonnet", recommendedIndex: 0 }),
						],
					),
				),
			),
		).toEqual({ providerID: "anthropic", id: "claude-sonnet" });
		expect(
			pickDefaultModel(
				buildCatalogFromModels({ ...ANTHROPIC, defaults: { anthropic: "claude-opus" } }),
			),
		).toEqual({ providerID: "anthropic", id: "claude-opus" });
		expect(pickDefaultModel(undefined)).toBeUndefined();
	});
});
