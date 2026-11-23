import type { IntegrationInfo, ModelInfo, ProviderInfo } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import { STORED_KEY_MARKER, toKiloProviderList } from "./kilo-v2-provider-list";

function integration(id: string, overrides: Partial<IntegrationInfo> = {}): IntegrationInfo {
	return { id, name: id.toUpperCase(), methods: [{ type: "key" }], connections: [], ...overrides };
}

function provider(id: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
	return { id, name: id.toUpperCase(), activation: "auto", package: "pkg", ...overrides };
}

function model(providerID: string, id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id,
		modelID: id,
		providerID,
		name: id,
		capabilities: { tools: true, input: ["text"], output: ["text"] },
		variants: [],
		time: { released: 0 },
		cost: [],
		status: "active",
		enabled: true,
		limit: { context: 1000, output: 100 },
		...overrides,
	};
}

describe("toKiloProviderList", () => {
	it("lists every integration, connected by provider.list, with sources from its connections", () => {
		const list = toKiloProviderList({
			integrations: [
				integration("openai", {
					methods: [{ type: "key" }, { type: "env", names: ["OPENAI_API_KEY"] }],
					connections: [{ type: "credential", id: "c1", label: "OpenAI", method: "key" }],
				}),
				integration("anthropic", {
					connections: [{ type: "env", name: "ANTHROPIC_API_KEY" }],
				}),
				integration("deepseek"),
				integration("github", { metadata: { source: "mcp" } }),
			],
			providers: [
				provider("openai"),
				provider("anthropic"),
				provider("mycustom", { name: "Mine" }),
			],
			models: [],
			defaultModel: null,
		});

		expect(list.connected).toEqual(["openai", "anthropic", "mycustom"]);
		expect(list.all).toEqual([
			{
				id: "openai",
				name: "OPENAI",
				source: "api",
				env: ["OPENAI_API_KEY"],
				key: STORED_KEY_MARKER,
				models: {},
			},
			{ id: "anthropic", name: "ANTHROPIC", source: "env", env: [], models: {} },
			{ id: "deepseek", name: "DEEPSEEK", env: [], models: {} },
			{ id: "mycustom", name: "Mine", source: "config", env: [], models: {} },
		]);
	});

	it("maps enabled models with variants, limits, attachments and Kilo's free models", () => {
		const list = toKiloProviderList({
			integrations: [integration("kilo")],
			providers: [provider("kilo")],
			models: [
				model("kilo", "kilo-auto/free", {
					cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
					variants: [{ id: "low" }, { id: "high", settings: { reasoning: { effort: "high" } } }],
					capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
				}),
				model("kilo", "paid", { cost: [{ input: 1, output: 4, cache: { read: 0, write: 0 } }] }),
				model("kilo", "off", { enabled: false }),
			],
			defaultModel: model("kilo", "paid"),
		});

		expect(list.default).toEqual({ kilo: "paid" });
		expect(list.all[0]?.models).toEqual({
			"kilo-auto/free": {
				id: "kilo-auto/free",
				name: "kilo-auto/free",
				providerID: "kilo",
				variants: { low: {}, high: { reasoning: { effort: "high" } } },
				limit: { context: 1000, output: 100 },
				capabilities: { reasoning: true, attachment: true },
				isFree: true,
				cost: { output: 0 },
			},
			paid: {
				id: "paid",
				name: "paid",
				providerID: "kilo",
				variants: {},
				limit: { context: 1000, output: 100 },
				capabilities: { reasoning: false, attachment: false },
				isFree: false,
				cost: { output: 4 },
			},
		});
	});
});
