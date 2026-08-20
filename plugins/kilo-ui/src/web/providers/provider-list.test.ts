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
	disabled_providers: ["openai"],
	provider: {
		vllm: {
			npm: "@ai-sdk/openai-compatible",
			name: "Local vLLM",
			options: { baseURL: "http://127.0.0.1:8000/v1" },
		},
	},
};

describe("groupProviderList", () => {
	it("keeps disabled providers in Connected when provider.list drops them from connected", () => {
		const view = groupProviderList({
			all: [kilo, anthropic, groq, vllm],
			connected: ["kilo", "anthropic", "groq", "vllm"],
			config,
		});

		expect(view.connected.map((row) => row.id)).toEqual([
			"kilo",
			"anthropic",
			"groq",
			"vllm",
			"openai",
		]);
		expect(view.connected.find((row) => row.id === "openai")).toMatchObject({
			name: "OpenAI",
			connected: true,
			disabled: true,
			canDisable: true,
			source: "api",
		});
		expect(view.popular.every((row) => !row.canDisable && !row.disabled)).toBe(true);
	});

	it("lists connected providers alphabetically by name", () => {
		const view = groupProviderList({
			all: [kilo, openai, groq, anthropic],
			connected: ["openai", "kilo", "groq", "anthropic"],
			config: {},
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo", "anthropic", "groq", "openai"]);
	});

	it("keeps a disabled provider in Connected in alphabetical order", () => {
		const view = groupProviderList({
			all: [kilo, anthropic, openai, groq],
			connected: ["kilo", "anthropic", "groq"],
			config: { disabled_providers: ["openai"] },
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo", "anthropic", "groq", "openai"]);
		expect(view.connected.find((row) => row.id === "openai")?.disabled).toBe(true);
	});

	it("marks a still-listed connected provider as disabled without moving it", () => {
		const view = groupProviderList({
			all: [kilo, anthropic],
			connected: ["kilo", "anthropic"],
			config: { disabled_providers: ["anthropic"] },
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo", "anthropic"]);
		expect(view.connected.find((row) => row.id === "anthropic")?.disabled).toBe(true);
		expect(view.popular.map((row) => row.id)).not.toContain("anthropic");
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
		expect(view.popular.every((row) => !row.disabled && !row.canDisable)).toBe(true);
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
			disabled: false,
			canDisconnect: true,
		});
	});

	it("does not list disabled providers under Popular", () => {
		const view = groupProviderList({
			all: [kilo],
			connected: ["kilo"],
			config: { disabled_providers: ["openai"] },
		});
		expect(view.connected.find((row) => row.id === "openai")).toMatchObject({
			name: "OpenAI",
			disabled: true,
			connected: true,
			source: "api",
		});
		expect(view.popular.map((row) => row.id)).not.toContain("openai");
	});

	it("tags custom npm packages and blocks disconnect on env-sourced providers", () => {
		const view = groupProviderList({
			all: [groq, vllm],
			connected: ["groq", "vllm"],
			config,
		});
		const groqRow = view.connected.find((row) => row.id === "groq");
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
			canDisable: false,
			custom: false,
			disabled: false,
		});
	});
});
