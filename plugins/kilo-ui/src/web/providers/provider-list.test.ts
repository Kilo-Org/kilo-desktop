import { describe, expect, it } from "vitest";

import {
	groupProviderList,
	type CatalogProvider,
	type GlobalProviderConfig,
} from "./provider-list.js";

const anthropic: CatalogProvider = {
	id: "anthropic",
	name: "Anthropic",
	source: "api",
};

const openai: CatalogProvider = {
	id: "openai",
	name: "OpenAI",
	source: "api",
};

const groq: CatalogProvider = {
	id: "groq",
	name: "Groq",
	source: "env",
	env: ["GROQ_API_KEY"],
};

const kilo: CatalogProvider = {
	id: "kilo",
	name: "Kilo Gateway",
	source: "custom",
};

const vllm: CatalogProvider = {
	id: "vllm",
	name: "Local vLLM",
	source: "config",
};

const config: GlobalProviderConfig = {
	provider: {
		vllm: {
			npm: "@ai-sdk/openai-compatible",
			name: "Local vLLM",
			options: { baseURL: "http://127.0.0.1:8000/v1" },
		},
	},
};

describe("groupProviderList", () => {
	it("lists connected providers alphabetically by name", () => {
		const view = groupProviderList({
			all: [kilo, openai, groq, anthropic],
			connected: ["openai", "kilo", "groq", "anthropic"],
			config: {},
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo", "anthropic", "openai"]);
		expect(view.environment.map((row) => row.id)).toEqual(["groq"]);
	});

	it("lists env-sourced providers under Environment, not Connected", () => {
		const view = groupProviderList({
			all: [kilo, anthropic, groq],
			connected: ["kilo", "anthropic", "groq"],
			config: {},
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo", "anthropic"]);
		expect(view.environment).toEqual([
			expect.objectContaining({
				id: "groq",
				name: "Groq",
				connected: true,
				source: "env",
				canDisconnect: false,
			}),
		]);
		expect(view.popular.map((row) => row.id)).not.toContain("groq");
	});

	it("keeps Kilo Gateway first in connected even when the catalog lists it later", () => {
		const view = groupProviderList({
			all: [anthropic, kilo, openai],
			connected: ["anthropic", "kilo"],
			config: {},
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo", "anthropic"]);
	});

	it("lists popular providers that are not connected", () => {
		const view = groupProviderList({
			all: [kilo, anthropic, openai],
			connected: ["kilo"],
			config: {},
		});
		expect(view.popular.map((row) => row.id)).toEqual([
			"anthropic",
			"deepseek",
			"openai",
			"google",
			"openrouter",
			"vercel",
		]);
		expect(view.popular.every((row) => row.id !== "kilo")).toBe(true);
	});

	it("keeps popular providers reconnectable when provider.list omits them after disconnect", () => {
		const view = groupProviderList({
			all: [kilo],
			connected: ["kilo"],
			config: {},
		});
		expect(view.popular.map((row) => row.id)).toEqual([
			"anthropic",
			"deepseek",
			"openai",
			"google",
			"openrouter",
			"vercel",
		]);
		expect(view.popular.find((row) => row.id === "openai")).toMatchObject({
			name: "OpenAI",
			connected: false,
			canDisconnect: true,
		});
	});

	it("tags custom npm packages and blocks disconnect on env-sourced providers", () => {
		const view = groupProviderList({
			all: [groq, vllm],
			connected: ["groq", "vllm"],
			config,
		});
		const groqRow = view.environment.find((row) => row.id === "groq");
		const vllmRow = view.connected.find((row) => row.id === "vllm");
		expect(groqRow?.canDisconnect).toBe(false);
		expect(groqRow?.custom).toBe(false);
		expect(vllmRow?.custom).toBe(true);
		expect(vllmRow?.canDisconnect).toBe(true);
	});

	it("marks kilo as account-managed, not disconnectable from this list", () => {
		const view = groupProviderList({
			all: [kilo],
			connected: ["kilo"],
			config: {},
		});
		expect(view.connected[0]).toMatchObject({
			id: "kilo",
			isKilo: true,
			canDisconnect: false,
			custom: false,
		});
	});
});
