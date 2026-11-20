import { describe, expect, it } from "vitest";

import { z } from "zod";

import { aiProviderSchema, modelSchema } from "../../contracts";
import { mapAiProviderList } from "./ai-provider-list";
import type { KiloProvider, KiloProviderModel } from "./kilo-models-client";

function model(id: string, patch: Partial<KiloProviderModel> = {}): KiloProviderModel {
	return { id, name: id, ...patch };
}

function provider(
	id: string,
	source: NonNullable<KiloProvider["source"]>,
	patch: Partial<KiloProvider> = {},
): KiloProvider {
	return { id, name: id, source, models: {}, ...patch };
}

const kilo = provider("kilo", "custom", {
	name: "Kilo Gateway",
	models: {
		"kilo-auto/free": model("kilo-auto/free", {
			name: "Auto Free (free)",
			isFree: true,
			capabilities: { reasoning: false, attachment: true },
			limit: { context: 200_000, output: 32_000 },
		}),
	},
});
const anthropic = provider("anthropic", "api", {
	name: "Anthropic",
	key: "sk-ant",
	models: {
		sonnet: model("sonnet", {
			name: "Sonnet ($$$)",
			variants: { low: {}, high: {} },
			capabilities: { reasoning: true, attachment: true },
			limit: { context: 1_000_000, output: 0 },
		}),
	},
});
const groq = provider("groq", "env", { name: "Groq", env: ["GROQ_API_KEY"] });
const openai = provider("openai", "api", { name: "OpenAI", models: { gpt: model("gpt") } });

const providersSchema = z.record(z.string(), aiProviderSchema);
const modelsSchema = z.record(z.string(), modelSchema);

describe("mapAiProviderList", () => {
	it("lists models of connected AI providers only, keyed <aiProviderId>/<modelId>", () => {
		const { models } = mapAiProviderList({
			list: { all: [kilo, anthropic, openai], connected: ["kilo", "anthropic"] },
			config: {},
			contributed: new Set(),
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

	it("reads efforts from reasoning options when a model has no variants", () => {
		const { models } = mapAiProviderList({
			list: {
				all: [
					provider("acme", "api", {
						models: {
							deep: model("deep", {
								reasoning_options: [
									{ type: "budget", values: ["1k"] },
									{ type: "effort", values: ["low", "medium"] },
								],
							}),
						},
					}),
				],
				connected: ["acme"],
			},
			config: {},
			contributed: new Set(),
		});
		expect(models["acme/deep"]).toMatchObject({
			variants: ["low", "medium"],
			attachments: false,
			reasoning: false,
		});
	});

	it("describes where each AI provider comes from and whether the user can disconnect it", () => {
		const bedrock = provider("amazon-bedrock", "custom", {
			name: "Amazon Bedrock",
			env: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
		});
		const vllm = provider("vllm", "config", { name: "Local vLLM" });
		const configured = provider("azure", "config", { name: "Azure" });
		const local = provider("local-server", "config", { name: "Local Model Server" });

		const { aiProviders } = mapAiProviderList({
			list: {
				all: [kilo, anthropic, groq, bedrock, vllm, configured, local],
				connected: ["kilo", "anthropic", "groq", "amazon-bedrock", "vllm", "azure", "local-server"],
			},
			config: { provider: { vllm: { npm: "@ai-sdk/openai-compatible", name: "Local vLLM" } } },
			contributed: new Set(["local-server"]),
		});

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
		expect(aiProviders["amazon-bedrock"]).toMatchObject({ source: "env", canDisconnect: false });
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

	it("keeps popular AI providers reconnectable when the list omits them", () => {
		const { aiProviders } = mapAiProviderList({
			list: { all: [kilo], connected: ["kilo"] },
			config: {},
			contributed: new Set(),
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
			source: "api",
			env: [],
			canDisconnect: true,
		});
	});

	it("lists unconnected catalog AI providers and connected ones the catalog omits", () => {
		const { aiProviders, models } = mapAiProviderList({
			list: { all: [openai], connected: ["vllm", "mystery"] },
			config: { provider: { vllm: { npm: "@ai-sdk/openai-compatible", name: " My vLLM " } } },
			contributed: new Set(),
		});

		expect(aiProviders.openai).toMatchObject({ connected: false, source: "api" });
		expect(aiProviders.vllm).toMatchObject({
			name: "My vLLM",
			connected: true,
			source: "custom",
			canDisconnect: true,
		});
		expect(aiProviders.mystery).toEqual({
			id: "mystery",
			name: "mystery",
			connected: true,
			env: [],
			canDisconnect: false,
		});
		expect(models).toEqual({});
	});

	it("lists custom AI providers in the config that Kilo didn't load, so they can be edited", () => {
		const { aiProviders } = mapAiProviderList({
			list: { all: [], connected: [] },
			config: {
				provider: {
					broken: { npm: "@ai-sdk/openai-compatible" },
					plain: { options: {} },
					gone: null,
				},
			},
			contributed: new Set(),
		});
		expect(aiProviders.broken).toMatchObject({
			name: "broken",
			connected: false,
			source: "custom",
			canDisconnect: true,
		});
		expect(aiProviders.plain).toBeUndefined();
		expect(aiProviders.gone).toBeUndefined();
	});

	it("passes on what pickers rank and describe models by, and each AI provider's default", () => {
		const mapped = mapAiProviderList({
			list: {
				all: [
					provider("acme", "api", {
						models: {
							fast: model("fast", {
								recommendedIndex: 2,
								options: { description: "Quick answers." },
								cost: { output: 4.5 },
								hasUserByokAvailable: true,
							}),
							plain: model("plain", { recommendedIndex: -1, cost: { output: -1 } }),
						},
					}),
				],
				connected: ["acme"],
				default: { acme: "fast", gone: "x" },
			},
			config: { model: "acme/fast" },
			contributed: new Set(),
		});

		expect(mapped.models["acme/fast"]).toMatchObject({
			recommendedIndex: 2,
			description: "Quick answers.",
			outputPricePerMillion: 4.5,
			// Only Kilo Gateway models can use the user's own keys.
			byok: false,
		});
		const plain = mapped.models["acme/plain"]!;
		expect([plain.recommendedIndex, plain.outputPricePerMillion, plain.byok]).toEqual([
			undefined,
			undefined,
			false,
		]);
		expect(mapped.defaults).toEqual({ acme: "fast" });
		expect(
			mapAiProviderList({
				list: {
					all: [
						provider("kilo", "custom", {
							models: { m: model("m", { hasUserByokAvailable: true }) },
						}),
					],
					connected: ["kilo"],
				},
				config: {},
				contributed: new Set(),
			}).models["kilo/m"]?.byok,
		).toBe(true);
		expect(mapped.configuredModel).toEqual({ aiProviderId: "acme", modelId: "fast" });
		expect(() => z.array(modelSchema).parse(Object.values(mapped.models))).not.toThrow();
	});

	it("ignores a configured model that isn't <aiProviderId>/<modelId>", () => {
		const mapped = mapAiProviderList({
			list: { all: [], connected: [] },
			config: { model: "no-slash" },
			contributed: new Set(),
		});

		expect(mapped.configuredModel).toBeUndefined();
		expect(mapped.defaults).toEqual({});
	});

	it("drops limits that aren't positive integers", () => {
		const { models } = mapAiProviderList({
			list: {
				all: [
					provider("acme", "api", {
						models: { m: model("m", { limit: { context: -1, output: 1.5 } }) },
					}),
				],
				connected: ["acme"],
			},
			config: {},
			contributed: new Set(),
		});
		expect(models["acme/m"]).not.toHaveProperty("contextWindow");
		expect(models["acme/m"]).not.toHaveProperty("maxOutputTokens");
	});
});
