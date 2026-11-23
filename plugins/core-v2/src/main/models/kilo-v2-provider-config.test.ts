import { describe, expect, it } from "vitest";

import { toKiloProviderEntry, withCustomProviderDeletions } from "./custom-ai-provider";
import { toV1GlobalConfig, toV2SettingsPatch } from "./kilo-v2-provider-config";

const V2_DOCUMENT = {
	model: { providerID: "mycustom", model: "m1", variant: "high" },
	providers: {
		mycustom: {
			name: "Mine",
			package: "@ai-sdk/openai-compatible",
			settings: { baseURL: "https://llm.example/v1" },
			headers: { "X-Team": "a" },
			models: {
				m1: {
					name: "One",
					capabilities: {
						reasoning: { supported: true },
						input: ["text", "image"],
						output: ["text"],
					},
					limit: { context: 1000, output: 100 },
				},
			},
		},
	},
	permissions: [],
};

describe("toV1GlobalConfig", () => {
	it("reads v2 providers and the model selection in the v1 keys custom providers use", () => {
		expect(toV1GlobalConfig(V2_DOCUMENT)).toEqual({
			model: "mycustom/m1",
			provider: {
				mycustom: {
					npm: "@ai-sdk/openai-compatible",
					name: "Mine",
					options: { baseURL: "https://llm.example/v1", headers: { "X-Team": "a" } },
					models: {
						m1: {
							name: "One",
							reasoning: true,
							modalities: { input: ["text", "image"], output: ["text"] },
							limit: { context: 1000, output: 100 },
						},
					},
				},
			},
		});
		expect(toV1GlobalConfig({ model: "p/m#v" })).toEqual({ model: "p/m" });
		expect(toV1GlobalConfig({})).toEqual({});
	});
});

describe("toV2SettingsPatch", () => {
	it("writes a saved custom provider in v2 keys, deleting what the user removed", () => {
		const existing = toV1GlobalConfig(V2_DOCUMENT).provider!.mycustom;
		const next = toKiloProviderEntry(
			{
				aiProviderId: "mycustom",
				name: "Mine",
				baseUrl: "https://llm.example/v2",
				models: [{ modelId: "m2", name: "Two", attachments: false }],
			},
			existing,
		);
		if ("error" in next) throw new Error(next.error);

		expect(
			toV2SettingsPatch({
				provider: { mycustom: withCustomProviderDeletions(existing, next.value) },
			}),
		).toEqual({
			providers: {
				mycustom: {
					package: "@ai-sdk/openai-compatible",
					name: "Mine",
					settings: { baseURL: "https://llm.example/v2" },
					headers: null,
					models: {
						m1: null,
						m2: { name: "Two" },
					},
				},
			},
		});
	});

	it("deletes a provider and sets the model", () => {
		expect(toV2SettingsPatch({ provider: { gone: null }, model: "openai/gpt-5" })).toEqual({
			providers: { gone: null },
			model: "openai/gpt-5",
		});
	});

	it("clears a model's reasoning and modalities with nulls", () => {
		expect(
			toV2SettingsPatch({
				provider: {
					p: { models: { m: { name: "M", reasoning: null, modalities: null, limit: null } } },
				},
			}),
		).toEqual({
			providers: {
				p: {
					models: {
						m: {
							name: "M",
							capabilities: { reasoning: null, input: null, output: null },
							limit: null,
						},
					},
				},
			},
		});
	});
});
