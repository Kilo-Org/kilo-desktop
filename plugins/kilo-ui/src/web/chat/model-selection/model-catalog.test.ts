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

	it("sorts Kilo Gateway first among providers", () => {
		const withGateway: KiloProviderListPayload = {
			all: [
				{
					id: "amazon-bedrock",
					name: "Amazon Bedrock",
					models: {
						nova: { id: "nova", name: "Nova", providerID: "amazon-bedrock" },
					},
				},
				{
					id: "kilo",
					name: "Kilo Gateway",
					models: {
						auto: { id: "auto", name: "Auto", providerID: "kilo" },
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
			default: { kilo: "auto" },
			connected: ["amazon-bedrock", "kilo", "anthropic"],
		};
		const catalog = buildCatalogFromProviderList(withGateway);
		expect(catalog.providers.map((provider) => provider.id)).toEqual([
			"kilo",
			"amazon-bedrock",
			"anthropic",
		]);
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
