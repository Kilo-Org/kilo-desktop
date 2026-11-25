import { describe, expect, it } from "vitest";

import { z } from "zod";

import { aiProviderSchema, modelSchema } from "../../contracts";
import { mapAiProviderList, type AiProviderListInput } from "./ai-provider-list";
import type { KiloCatalog } from "./kilo-models-client";
import { EMPTY_CATALOG, integration, model, provider } from "./test-kilo-client";

const providersSchema = z.record(z.string(), aiProviderSchema);
const modelsSchema = z.record(z.string(), modelSchema);

function map(
	catalog: Partial<KiloCatalog>,
	rest: Partial<Omit<AiProviderListInput, "catalog">> = {},
) {
	return mapAiProviderList({
		catalog: { ...EMPTY_CATALOG, ...catalog },
		config: rest.config ?? {},
		contributed: rest.contributed ?? new Set(),
	});
}

const kilo = provider("kilo", { name: "Kilo Gateway" });
const anthropic = provider("anthropic", { name: "Anthropic" });
const freeAuto = model("kilo", "kilo-auto/free", {
	name: "Auto Free (free)",
	capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
	limit: { context: 200_000, output: 32_000 },
});
const sonnet = model("anthropic", "sonnet", {
	name: "Sonnet ($$$)",
	variants: [{ id: "low" }, { id: "high" }],
	capabilities: { tools: true, input: ["text", "pdf"], output: ["text"] },
	limit: { context: 1_000_000, output: 0 },
});

describe("mapAiProviderList", () => {
	it("lists models Kilo enables, keyed <aiProviderId>/<modelId>, with the gateway's free flag", () => {
		const { models } = map({
			providers: [kilo, anthropic],
			models: [freeAuto, sonnet, model("anthropic", "retired", { enabled: false })],
			gateway: [{ id: "kilo-auto/free", isFree: true }],
		});

		expect(models).toEqual({
			"kilo/kilo-auto/free": {
				aiProviderId: "kilo",
				modelId: "kilo-auto/free",
				name: "Auto Free",
				variants: [],
				contextWindow: 200_000,
				maxOutputTokens: 32_000,
				attachments: true,
				reasoning: false,
				free: true,
				byok: false,
			},
			"anthropic/sonnet": {
				aiProviderId: "anthropic",
				modelId: "sonnet",
				name: "Sonnet",
				variants: ["low", "high"],
				contextWindow: 1_000_000,
				attachments: true,
				reasoning: true,
				free: false,
				byok: false,
			},
		});
		expect(modelsSchema.safeParse(models).success).toBe(true);
	});

	it("leaves out models of a provider Kilo has disabled", () => {
		const { models, aiProviders } = map({
			providers: [provider("acme", { activation: "disabled" })],
			models: [model("acme", "m")],
		});
		expect(models).toEqual({});
		expect(aiProviders.acme).toBeUndefined();
	});

	it("describes where each AI provider comes from and whether the user can disconnect it", () => {
		const { aiProviders } = map(
			{
				providers: [
					kilo,
					anthropic,
					provider("groq", { name: "Groq" }),
					provider("amazon-bedrock", { name: "Amazon Bedrock" }),
					provider("vllm", { name: "Local vLLM", integrationID: undefined }),
					provider("azure", { name: "Azure", integrationID: undefined }),
					provider("local-server", { name: "Local Model Server", integrationID: undefined }),
				],
				integrations: [
					integration("kilo", { connections: [{ type: "credential" }] }),
					integration("anthropic", { connections: [{ type: "credential" }] }),
					integration("groq", {
						methods: [{ type: "env", names: ["GROQ_API_KEY"] }],
						connections: [{ type: "env" }],
					}),
					integration("amazon-bedrock", {
						methods: [{ type: "env", names: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"] }],
						connections: [{ type: "env" }],
					}),
				],
			},
			{
				config: {
					providers: { vllm: { package: "@ai-sdk/openai-compatible", name: "Local vLLM" } },
				},
				contributed: new Set(["local-server"]),
			},
		);

		expect(aiProviders.kilo).toEqual({
			id: "kilo",
			name: "Kilo Gateway",
			connected: true,
			source: "kilo",
			env: [],
			canDisconnect: false,
		});
		expect(aiProviders.anthropic).toMatchObject({ source: "api", canDisconnect: true });
		expect(aiProviders.groq).toMatchObject({
			source: "env",
			env: ["GROQ_API_KEY"],
			canDisconnect: false,
		});
		expect(aiProviders["amazon-bedrock"]?.env).toEqual([
			"AWS_ACCESS_KEY_ID",
			"AWS_PROFILE",
			"AWS_SSO_START_URL",
		]);
		expect(aiProviders.vllm).toMatchObject({ source: "custom", canDisconnect: true });
		expect(aiProviders.azure).toMatchObject({ source: "config", canDisconnect: false });
		expect(aiProviders["local-server"]).toMatchObject({
			name: "Local Model Server",
			connected: true,
			source: "plugin",
			canDisconnect: false,
		});
		expect(providersSchema.safeParse(aiProviders).success).toBe(true);
	});

	it("keeps popular AI providers connectable when Kilo hasn't enabled them", () => {
		const { aiProviders } = map({
			providers: [kilo],
			integrations: [integration("openai", { name: "OpenAI" })],
		});

		expect(Object.keys(aiProviders).toSorted()).toEqual([
			"anthropic",
			"deepseek",
			"google",
			"kilo",
			"openai",
			"openrouter",
			"vercel",
		]);
		expect(aiProviders.openai).toEqual({
			id: "openai",
			name: "OpenAI",
			connected: false,
			env: [],
			canDisconnect: false,
		});
	});

	it("lists custom AI providers in the config that Kilo didn't enable, so they can be edited", () => {
		const { aiProviders } = map(
			{},
			{
				config: {
					providers: {
						broken: { package: "@ai-sdk/openai-compatible", name: " My vLLM " },
						plain: { settings: {} },
						gone: null,
					},
				},
			},
		);
		expect(aiProviders.broken).toMatchObject({
			name: "My vLLM",
			connected: false,
			source: "custom",
			canDisconnect: true,
		});
		expect(aiProviders.plain).toBeUndefined();
		expect(aiProviders.gone).toBeUndefined();
	});

	it("passes on the gateway's ranking, description and BYOK, and prices from the base tier", () => {
		const mapped = map({
			providers: [kilo, provider("acme")],
			models: [
				model("kilo", "fast", {
					cost: [
						{ input: 1, output: 4.5 },
						{ tier: { type: "context", size: 200_000 }, input: 2, output: 9 },
					],
				}),
				model("acme", "plain", { cost: [{ input: 1, output: -1 }] }),
			],
			gateway: [
				{
					id: "fast",
					isFree: false,
					recommendedIndex: 2,
					description: "Quick answers.",
					hasUserByokAvailable: true,
				},
			],
		});

		expect(mapped.models["kilo/fast"]).toMatchObject({
			recommendedIndex: 2,
			description: "Quick answers.",
			outputPricePerMillion: 4.5,
			byok: true,
		});
		const plain = mapped.models["acme/plain"]!;
		expect([plain.recommendedIndex, plain.outputPricePerMillion, plain.byok]).toEqual([
			undefined,
			undefined,
			false,
		]);
		expect(() => z.array(modelSchema).parse(Object.values(mapped.models))).not.toThrow();
	});

	it("takes Kilo's default from the gateway's recommendation, and Kilo's own default otherwise", () => {
		const mapped = map(
			{
				providers: [kilo, anthropic],
				models: [model("kilo", "auto"), model("kilo", "fast"), sonnet],
				gateway: [
					{ id: "fast", isFree: false },
					{ id: "auto", isFree: false, recommended: true },
				],
				defaultModel: { providerID: "anthropic", id: "sonnet" },
			},
			{ config: { model: { providerID: "anthropic", id: "sonnet" } } },
		);

		expect(mapped.defaults).toEqual({ kilo: "auto", anthropic: "sonnet" });
		expect(mapped.configuredModel).toEqual({ aiProviderId: "anthropic", modelId: "sonnet" });
		expect(map({}, { config: { model: "anthropic/sonnet" } }).configuredModel).toEqual({
			aiProviderId: "anthropic",
			modelId: "sonnet",
		});
	});

	it("ignores a configured model that isn't a provider and model", () => {
		const mapped = map(
			{ defaultModel: { providerID: "gone", id: "x" } },
			{ config: { model: "no-slash" } },
		);

		expect(mapped.configuredModel).toBeUndefined();
		expect(mapped.defaults).toEqual({});
	});

	it("drops limits that aren't positive integers", () => {
		const { models } = map({
			providers: [provider("acme")],
			models: [model("acme", "m", { limit: { context: -1, output: 1.5 } })],
		});
		expect(models["acme/m"]).not.toHaveProperty("contextWindow");
		expect(models["acme/m"]).not.toHaveProperty("maxOutputTokens");
	});
});
