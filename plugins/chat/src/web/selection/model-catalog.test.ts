import { describe, expect, it } from "vitest";

import {
	attachGatewayModelDetails,
	buildCatalogFromProviderList,
	isKiloGatewayProvider,
	modelRefToId,
	parseModelId,
	pickDefaultModel,
	type KiloProviderListPayload,
} from "./model-catalog";

const payload: KiloProviderListPayload = {
	all: [
		{
			id: "anthropic",
			name: "Anthropic",
			models: {
				"claude-sonnet": {
					id: "claude-sonnet",
					name: "Claude Sonnet",
					providerID: "anthropic",
					cost: { output: 15 },
				},
				"claude-opus": {
					id: "claude-opus",
					name: "Claude Opus",
					providerID: "anthropic",
				},
			},
		},
		{
			id: "openai",
			name: "OpenAI",
			models: {
				"gpt-5": {
					id: "gpt-5",
					name: "GPT-5",
					providerID: "openai",
				},
			},
		},
	],
	default: {
		anthropic: "claude-sonnet",
		openai: "gpt-5",
	},
	connected: ["anthropic"],
};

describe("model-catalog", () => {
	it("round-trips model ids", () => {
		expect(modelRefToId({ providerID: "anthropic", modelID: "claude-sonnet" })).toBe(
			"anthropic/claude-sonnet",
		);
		expect(parseModelId("anthropic/claude-sonnet")).toEqual({
			providerID: "anthropic",
			modelID: "claude-sonnet",
		});
		expect(parseModelId("anthropic/org/model")).toEqual({
			providerID: "anthropic",
			modelID: "org/model",
		});
		expect(parseModelId("bad")).toBeNull();
	});

	it("recognizes the Kilo Gateway provider by id or name", () => {
		expect(isKiloGatewayProvider({ id: "kilo" })).toBe(true);
		expect(isKiloGatewayProvider({ id: "kilo", name: "Kilo Gateway" })).toBe(true);
		expect(isKiloGatewayProvider({ id: "other", name: "Kilo Gateway" })).toBe(true);
		expect(isKiloGatewayProvider({ id: "anthropic", name: "Anthropic" })).toBe(false);
	});

	it("builds a connected-only catalog by default", () => {
		const catalog = buildCatalogFromProviderList(payload);
		expect(catalog.providers).toEqual([{ id: "anthropic", name: "Anthropic", connected: true }]);
		expect(catalog.models.map((model) => model.id)).toEqual([
			"anthropic/claude-sonnet",
			"anthropic/claude-opus",
		]);
		expect(catalog.defaults.anthropic).toBe("claude-sonnet");
		expect(catalog.models[0]?.costTier).toBe("high");
	});

	it("strips Gateway price markers like ($$$$) and (free) from model names", () => {
		const catalog = buildCatalogFromProviderList({
			all: [
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						"anthropic/claude-fable-5": {
							id: "anthropic/claude-fable-5",
							name: "Anthropic: Claude Fable 5 ($$$$)",
							providerID: "kilo",
						},
						"openai/gpt-5": { id: "openai/gpt-5", name: "OpenAI: GPT-5 ($$)", providerID: "kilo" },
						"qwen/qwen3.8-max": {
							id: "qwen/qwen3.8-max",
							name: "Qwen: Qwen3.8 Max (0902)",
							providerID: "kilo",
						},
						"poolside/laguna-s-2.1:free": {
							id: "poolside/laguna-s-2.1:free",
							name: "Poolside: Laguna S 2.1 (free)",
							providerID: "kilo",
						},
						"odd/only-dollars": { id: "odd/only-dollars", name: "($)", providerID: "kilo" },
					},
				},
			],
			default: {},
			connected: ["kilo"],
		});

		expect(catalog.models.map((model) => model.name)).toEqual([
			"Anthropic: Claude Fable 5",
			"OpenAI: GPT-5",
			"Qwen: Qwen3.8 Max (0902)",
			"Poolside: Laguna S 2.1",
			"($)",
		]);
	});

	it("preserves recommendation order metadata", () => {
		const catalog = buildCatalogFromProviderList({
			all: [
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						"anthropic/claude-opus": {
							id: "anthropic/claude-opus",
							name: "Claude Opus",
							providerID: "kilo",
							recommendedIndex: 2,
						},
					},
				},
			],
			default: {},
			connected: ["kilo"],
		});

		expect(catalog.models[0]?.recommendedIndex).toBe(2);
	});

	it("attaches public details only to matching Gateway models", () => {
		const catalog = buildCatalogFromProviderList(
			{
				all: [
					{
						id: "kilo",
						name: "Kilo Gateway",
						models: {
							"openai/gpt-5": {
								id: "openai/gpt-5",
								name: "GPT-5",
								providerID: "kilo",
							},
						},
					},
				],
				default: {},
				connected: ["kilo"],
			},
			{ connectedOnly: false },
		);

		const enriched = attachGatewayModelDetails(catalog, [
			{ modelID: "openai/gpt-5", kiloBenchScore: 0.75, mayTrainOnYourPrompts: false },
		]);

		expect(enriched?.models[0]?.details).toEqual({
			modelID: "openai/gpt-5",
			kiloBenchScore: 0.75,
			mayTrainOnYourPrompts: false,
		});
		expect(enriched?.models[0]?.isFree).toBeUndefined();
	});

	it("hoists the Gateway isFree flag onto the catalog model", () => {
		const catalog = buildCatalogFromProviderList(
			{
				all: [
					{
						id: "kilo",
						name: "Kilo Gateway",
						models: {
							"poolside/laguna-s-2.1:free": {
								id: "poolside/laguna-s-2.1:free",
								name: "Poolside Laguna S 2.1",
								providerID: "kilo",
							},
						},
					},
				],
				default: {},
				connected: ["kilo"],
			},
			{ connectedOnly: false },
		);

		const enriched = attachGatewayModelDetails(catalog, [
			{ modelID: "poolside/laguna-s-2.1:free", isFree: true, mayTrainOnYourPrompts: true },
		]);

		expect(enriched?.models[0]?.isFree).toBe(true);
	});

	it("does not treat paid kilo-auto/* models as free; only the Gateway flag counts", () => {
		const catalog = buildCatalogFromProviderList({
			all: [
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						"kilo-auto/efficient": {
							id: "kilo-auto/efficient",
							name: "Auto Efficient",
							providerID: "kilo",
						},
						"kilo-auto/free": { id: "kilo-auto/free", name: "Auto Free", providerID: "kilo" },
					},
				},
			],
			default: {},
			connected: ["kilo"],
		});

		expect(catalog.models.some((model) => model.isFree)).toBe(false);

		const enriched = attachGatewayModelDetails(catalog, [
			{ modelID: "kilo-auto/efficient", isFree: false },
			{ modelID: "kilo-auto/free", isFree: true },
		]);
		const freeIds = enriched?.models.filter((model) => model.isFree).map((model) => model.modelID);
		expect(freeIds).toEqual(["kilo-auto/free"]);
	});

	it("uses nested model descriptions for subtitles and falls back when empty", () => {
		const catalog = buildCatalogFromProviderList({
			...payload,
			all: [
				{
					...payload.all[0]!,
					models: {
						"claude-sonnet": {
							...payload.all[0]!.models["claude-sonnet"]!,
							options: { description: "Balanced intelligence and speed." },
						},
						"claude-opus": {
							...payload.all[0]!.models["claude-opus"]!,
							options: { description: "   " },
						},
					},
				},
			],
		});

		expect(catalog.models.map((model) => model.description)).toEqual([
			"Balanced intelligence and speed.",
			"Anthropic",
		]);
	});

	it("can include disconnected providers", () => {
		const catalog = buildCatalogFromProviderList(payload, { connectedOnly: false });
		expect(catalog.providers.map((provider) => provider.id)).toEqual(["anthropic", "openai"]);
		expect(catalog.models.find((model) => model.id === "openai/gpt-5")?.disabled).toBe(true);
	});

	it("picks the provider default when available", () => {
		const catalog = buildCatalogFromProviderList(payload);
		expect(pickDefaultModel(catalog)).toEqual({
			providerID: "anthropic",
			modelID: "claude-sonnet",
		});
	});

	it("ignores Kilo Gateway's provider.list default when it ranks a Gemini image model first", () => {
		const withGeminiDefault: KiloProviderListPayload = {
			all: [
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						"kilo-auto/frontier": {
							id: "kilo-auto/frontier",
							name: "Auto Frontier",
							providerID: "kilo",
						},
						"google/gemini-3-pro-image": {
							id: "google/gemini-3-pro-image",
							name: "Google: Nano Banana Pro (Gemini 3 Pro Image)",
							providerID: "kilo",
						},
					},
				},
			],
			default: { kilo: "google/gemini-3-pro-image" },
			connected: ["kilo"],
		};
		expect(pickDefaultModel(buildCatalogFromProviderList(withGeminiDefault))).toEqual({
			providerID: "kilo",
			modelID: "kilo-auto/frontier",
		});
	});

	it("prefers Auto Free over the provider-marked default", () => {
		const withAutoFree: KiloProviderListPayload = {
			all: [
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						auto: { id: "auto", name: "Auto", providerID: "kilo" },
						"kilo-auto/free": {
							id: "kilo-auto/free",
							name: "Auto Free",
							providerID: "kilo",
						},
						"kilo-auto/frontier": {
							id: "kilo-auto/frontier",
							name: "Auto Frontier",
							providerID: "kilo",
						},
					},
				},
			],
			default: { kilo: "auto" },
			connected: ["kilo"],
		};
		expect(pickDefaultModel(buildCatalogFromProviderList(withAutoFree))).toEqual({
			providerID: "kilo",
			modelID: "kilo-auto/free",
		});
	});

	it("does not pick a disconnected Auto Free model", () => {
		const disconnectedAutoFree: KiloProviderListPayload = {
			all: [
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						"kilo-auto/free": {
							id: "kilo-auto/free",
							name: "Auto Free",
							providerID: "kilo",
						},
					},
				},
				{
					id: "anthropic",
					name: "Anthropic",
					models: {
						"claude-sonnet": {
							id: "claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
						},
					},
				},
			],
			default: { anthropic: "claude-sonnet" },
			connected: ["anthropic"],
		};
		expect(
			pickDefaultModel(
				buildCatalogFromProviderList(disconnectedAutoFree, { connectedOnly: false }),
			),
		).toEqual({
			providerID: "anthropic",
			modelID: "claude-sonnet",
		});
	});

	it("orders providers like the AI providers page: Kilo, Local, then others by name", () => {
		const scrambled: KiloProviderListPayload = {
			all: [
				{
					id: "openai",
					name: "OpenAI",
					models: {
						"gpt-5": { id: "gpt-5", name: "GPT-5", providerID: "openai" },
					},
				},
				{
					id: "kilo-desktop-model-server",
					name: "Anaconda Local",
					models: {
						"qwen-3": {
							id: "qwen-3",
							name: "Qwen 3",
							providerID: "kilo-desktop-model-server",
						},
					},
				},
				{
					id: "anthropic",
					name: "Anthropic",
					models: {
						"claude-sonnet": {
							id: "claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
						},
					},
				},
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						auto: { id: "auto", name: "Auto", providerID: "kilo" },
					},
				},
			],
			default: { kilo: "auto" },
			connected: ["openai", "kilo-desktop-model-server", "anthropic", "kilo"],
		};
		const catalog = buildCatalogFromProviderList(scrambled);
		expect(catalog.providers.map((provider) => provider.id)).toEqual([
			"kilo",
			"kilo-desktop-model-server",
			"anthropic",
			"openai",
		]);
	});

	it("normalizes the connected local provider name", () => {
		const emptyLocal: KiloProviderListPayload = {
			all: [
				{
					id: "kilo-desktop-model-server",
					name: "Anaconda Local",
					models: {},
				},
				{
					id: "anthropic",
					name: "Anthropic",
					models: {
						"claude-sonnet": {
							id: "claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
						},
					},
				},
			],
			default: { anthropic: "claude-sonnet" },
			connected: ["kilo-desktop-model-server", "anthropic"],
		};
		const catalog = buildCatalogFromProviderList(emptyLocal);
		expect(catalog.providers).toMatchObject([
			{ id: "kilo-desktop-model-server", name: "Local Model Server" },
			{ id: "anthropic", name: "Anthropic" },
		]);
	});

	it("omits local models while the server is offline", () => {
		const disconnectedLocal: KiloProviderListPayload = {
			all: [
				{
					id: "kilo-desktop-model-server",
					name: "Anaconda Local",
					models: {
						"qwen-3": {
							id: "qwen-3",
							name: "Qwen 3",
							providerID: "kilo-desktop-model-server",
						},
					},
				},
				{
					id: "anthropic",
					name: "Anthropic",
					models: {
						"claude-sonnet": {
							id: "claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
						},
					},
				},
			],
			default: { anthropic: "claude-sonnet" },
			connected: ["anthropic"],
		};
		const catalog = buildCatalogFromProviderList(disconnectedLocal);
		expect(catalog.providers.map((provider) => provider.id)).toEqual(["anthropic"]);
		expect(catalog.models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet"]);
	});

	it("maps reasoning effort levels onto catalog models", () => {
		const withEfforts: KiloProviderListPayload = {
			all: [
				{
					id: "anthropic",
					name: "Anthropic",
					models: {
						"claude-sonnet": {
							id: "claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "max"] }],
						},
						"claude-haiku": {
							id: "claude-haiku",
							name: "Claude Haiku",
							providerID: "anthropic",
							variants: { high: {}, max: {} },
						},
					},
				},
			],
			default: { anthropic: "claude-sonnet" },
			connected: ["anthropic"],
		};
		const catalog = buildCatalogFromProviderList(withEfforts);
		expect(catalog.models.find((model) => model.id === "anthropic/claude-sonnet")?.efforts).toEqual(
			[
				{ id: "low", name: "Low" },
				{ id: "medium", name: "Med" },
				{ id: "high", name: "High" },
				{ id: "max", name: "Max" },
			],
		);
		expect(catalog.models.find((model) => model.id === "anthropic/claude-haiku")?.efforts).toEqual([
			{ id: "high", name: "High" },
			{ id: "max", name: "Max" },
		]);
	});

	it("copies the provider context window onto catalog models", () => {
		const withLimits: KiloProviderListPayload = {
			all: [
				{
					id: "anthropic",
					name: "Anthropic",
					models: {
						"claude-sonnet": {
							id: "claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							limit: { context: 200_000 },
						},
						"claude-haiku": {
							id: "claude-haiku",
							name: "Claude Haiku",
							providerID: "anthropic",
							contextLength: 64_000,
						},
					},
				},
			],
			default: { anthropic: "claude-sonnet" },
			connected: ["anthropic"],
		};
		const catalog = buildCatalogFromProviderList(withLimits);
		expect(
			catalog.models.find((model) => model.id === "anthropic/claude-sonnet")?.contextWindow,
		).toBe(200_000);
		expect(
			catalog.models.find((model) => model.id === "anthropic/claude-haiku")?.contextWindow,
		).toBe(64_000);
	});
});
