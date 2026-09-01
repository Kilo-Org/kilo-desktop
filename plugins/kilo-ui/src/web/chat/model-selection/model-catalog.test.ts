import { describe, expect, it } from "vitest";

import {
	buildCatalogFromProviderList,
	isKiloGatewayProvider,
	modelRefToId,
	parseModelId,
	pickDefaultModel,
	type KiloProviderListPayload,
} from "./model-catalog.js";

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
					id: "anaconda-local",
					name: "Anaconda Local",
					models: {
						"qwen-3": { id: "qwen-3", name: "Qwen 3", providerID: "anaconda-local" },
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
			connected: ["openai", "anaconda-local", "anthropic", "kilo"],
		};
		const catalog = buildCatalogFromProviderList(scrambled);
		expect(catalog.providers.map((provider) => provider.id)).toEqual([
			"kilo",
			"anaconda-local",
			"anthropic",
			"openai",
		]);
	});

	it("omits Local from the selector when it has no models", () => {
		const emptyLocal: KiloProviderListPayload = {
			all: [
				{
					id: "anaconda-local",
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
			connected: ["anaconda-local", "anthropic"],
		};
		const catalog = buildCatalogFromProviderList(emptyLocal);
		expect(catalog.providers.map((provider) => provider.id)).toEqual(["anthropic"]);
	});

	it("omits Local from the selector when the local server is not connected", () => {
		const disconnectedLocal: KiloProviderListPayload = {
			all: [
				{
					id: "anaconda-local",
					name: "Anaconda Local",
					models: {
						"qwen-3": { id: "qwen-3", name: "Qwen 3", providerID: "anaconda-local" },
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
		const catalog = buildCatalogFromProviderList(disconnectedLocal, { connectedOnly: false });
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
});
