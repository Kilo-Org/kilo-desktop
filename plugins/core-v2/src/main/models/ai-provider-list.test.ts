import { describe, expect, it } from "vitest";

import { z } from "zod";

import { aiProviderSchema, modelSchema } from "../../contracts";
import { hasStoredKey, mapAiProviderList, type AiProviderListInput } from "./ai-provider-list";
import type { KiloProviderAnswers, KiloSettings } from "./kilo-models-client";
import { integration, kiloModel, NO_AI_PROVIDERS, usableProvider } from "./test-kilo-client";

const providersSchema = z.record(z.string(), aiProviderSchema);
const modelsSchema = z.record(z.string(), modelSchema);

function map(
	answers: Partial<KiloProviderAnswers>,
	settings: KiloSettings = {},
	contributed: readonly string[] = [],
) {
	const input: AiProviderListInput = {
		answers: { ...NO_AI_PROVIDERS, ...answers },
		settings,
		contributed: new Set(contributed),
	};
	return mapAiProviderList(input);
}

describe("mapAiProviderList", () => {
	it("lists enabled models of connected AI providers only, keyed <aiProviderId>/<modelId>", () => {
		const { models } = map({
			integrations: [integration("kilo"), integration("anthropic"), integration("openai")],
			providers: [usableProvider("kilo"), usableProvider("anthropic")],
			models: [
				kiloModel("kilo", "kilo-auto/free", {
					name: "Auto Free (free)",
					images: true,
					context: 200_000,
					output: 32_000,
					cost: [{ input: 0, output: 0 }],
				}),
				kiloModel("anthropic", "sonnet", {
					name: "Sonnet ($$$)",
					variants: ["low", "high"],
					images: true,
					context: 1_000_000,
					cost: [{ input: 3, output: 15 }],
				}),
				kiloModel("anthropic", "retired", { enabled: false }),
				kiloModel("openai", "gpt"),
			],
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
				outputPricePerMillion: 0,
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
				outputPricePerMillion: 15,
				byok: false,
			},
		});
		expect(modelsSchema.safeParse(models).success).toBe(true);
	});

	it("counts only Kilo Gateway models that cost nothing as free", () => {
		const { models } = map({
			providers: [usableProvider("kilo"), usableProvider("acme")],
			models: [
				kiloModel("kilo", "unpriced"),
				kiloModel("kilo", "paid", { cost: [{ input: 0, output: 1 }] }),
				kiloModel("acme", "zero", { cost: [{ input: 0, output: 0 }] }),
			],
		});

		expect(Object.values(models).map(({ modelId, free }) => [modelId, free])).toEqual([
			["unpriced", false],
			["paid", false],
			["zero", false],
		]);
	});

	it("describes where each AI provider comes from and whether the user can disconnect it", () => {
		const { aiProviders } = map(
			{
				integrations: [
					integration("kilo", { name: "Kilo Gateway" }),
					integration("anthropic", { name: "Anthropic", connections: ["key"] }),
					integration("groq", { name: "Groq", env: ["GROQ_API_KEY"], connections: ["env"] }),
					integration("amazon-bedrock", {
						name: "Amazon Bedrock",
						env: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
						connections: ["env"],
					}),
					integration("vllm", { name: "Local vLLM" }),
					integration("azure", { name: "Azure" }),
					integration("local-server", { name: "Local Model Server" }),
					integration("github", { name: "GitHub MCP", mcp: true }),
				],
				providers: [
					"kilo",
					"anthropic",
					"groq",
					"amazon-bedrock",
					"vllm",
					"azure",
					"local-server",
				].map((id) => usableProvider(id)),
			},
			{ providers: { vllm: { package: "@ai-sdk/openai-compatible", name: "Local vLLM" } } },
			["local-server"],
		);

		expect(aiProviders.kilo).toEqual({
			id: "kilo",
			name: "kilo",
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
			connected: true,
			source: "plugin",
			canDisconnect: false,
		});
		expect(aiProviders.github).toBeUndefined();
		expect(providersSchema.safeParse(aiProviders).success).toBe(true);
	});

	it("names a provider as provider.list does, else as its integration does", () => {
		const { aiProviders } = map({
			integrations: [
				integration("acme", { name: "Acme Inc" }),
				integration("idle", { name: "Idle" }),
			],
			providers: [usableProvider("acme", "Acme")],
		});

		expect(aiProviders.acme).toMatchObject({ name: "Acme", connected: true });
		expect(aiProviders.idle).toEqual({
			id: "idle",
			name: "Idle",
			connected: false,
			env: [],
			canDisconnect: false,
		});
	});

	it("keeps popular AI providers reconnectable when Kilo doesn't know them", () => {
		const { aiProviders } = map({ providers: [usableProvider("kilo")] });

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
			source: "api",
			env: [],
			canDisconnect: true,
		});
	});

	it("lists custom AI providers in the settings that Kilo didn't load, so they can be edited", () => {
		const { aiProviders } = map(
			{},
			{
				providers: {
					broken: { package: "@ai-sdk/openai-compatible", name: " My vLLM " },
					plain: { settings: {} },
					gone: null,
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

	it("passes on Kilo's default model when its provider is connected", () => {
		const fast = kiloModel("acme", "fast");

		expect(map({ providers: [usableProvider("acme")], defaultModel: fast }).defaults).toEqual({
			acme: "fast",
		});
		expect(map({ defaultModel: fast }).defaults).toEqual({});
	});

	it("reads the configured model in each of Kilo's forms", () => {
		const configured = (model: unknown) => map({}, { model }).configuredModel;

		expect(configured("acme/fast")).toEqual({ aiProviderId: "acme", modelId: "fast" });
		expect(configured("kilo/kilo-auto/free#high")).toEqual({
			aiProviderId: "kilo",
			modelId: "kilo-auto/free",
		});
		expect(configured({ providerID: "acme", model: "fast" })).toEqual({
			aiProviderId: "acme",
			modelId: "fast",
		});
		expect(configured("no-slash")).toBeUndefined();
		expect(configured(undefined)).toBeUndefined();
	});

	it("drops limits that aren't positive integers", () => {
		const { models } = map({
			providers: [usableProvider("acme")],
			models: [kiloModel("acme", "odd", { context: 1.5, output: -1 })],
		});

		expect(models["acme/odd"]).not.toHaveProperty("contextWindow");
		expect(models["acme/odd"]).not.toHaveProperty("maxOutputTokens");
	});
});

describe("hasStoredKey", () => {
	it("is true only when a key credential is stored for the provider", () => {
		const answers: KiloProviderAnswers = {
			...NO_AI_PROVIDERS,
			integrations: [
				integration("keyed", { connections: ["key"] }),
				integration("oauth", { connections: ["oauth"] }),
				integration("env", { connections: ["env"] }),
			],
		};

		expect(["keyed", "oauth", "env", "unknown"].map((id) => hasStoredKey(answers, id))).toEqual([
			true,
			false,
			false,
			false,
		]);
	});
});
