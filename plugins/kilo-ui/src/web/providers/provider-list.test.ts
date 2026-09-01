import { describe, expect, it } from "vitest";

import {
	groupProviderList,
	isEnvironmentSourced,
	providerSourceLabel,
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

const local: CatalogProvider = {
	id: "anaconda-local",
	name: "Anaconda Local",
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
				env: ["GROQ_API_KEY"],
			}),
		]);
		expect(view.popular.map((row) => row.id)).not.toContain("groq");
	});

	it("treats autoloaded catalog providers as environment credentials, not stored API keys", () => {
		const bedrock: CatalogProvider = {
			id: "amazon-bedrock",
			name: "Amazon Bedrock",
			source: "custom",
			env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"],
		};
		const view = groupProviderList({
			all: [kilo, bedrock],
			connected: ["kilo", "amazon-bedrock"],
			config: {},
		});
		expect(view.connected.map((row) => row.id)).toEqual(["kilo"]);
		expect(view.environment).toEqual([
			expect.objectContaining({
				id: "amazon-bedrock",
				name: "Amazon Bedrock",
				connected: true,
				source: "custom",
				custom: false,
				canDisconnect: false,
			}),
		]);
		expect(view.environment[0]?.env).toContain("AWS_PROFILE");
		expect(view.environment[0]?.env).toContain("AWS_SSO_START_URL");
		expect(view.environment[0]?.env).toContain("AWS_ACCESS_KEY_ID");
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
			isLocal: false,
			managed: true,
			canDisconnect: false,
			custom: false,
		});
	});

	it("does not list anaconda-local in Connected; Local owns its own card", () => {
		const view = groupProviderList({
			all: [local],
			connected: ["anaconda-local"],
			config: {
				provider: {
					"anaconda-local": {
						npm: "@ai-sdk/openai-compatible",
						name: "Anaconda Local",
					},
				},
			},
		});

		expect(view.connected.map((row) => row.id)).not.toContain("anaconda-local");
		expect(view.popular.map((row) => row.id)).not.toContain("anaconda-local");
	});
});

describe("providerSourceLabel", () => {
	it("labels stored keys, env vars, custom endpoints, and autoloaded credentials distinctly", () => {
		expect(providerSourceLabel({ source: "api", custom: false })).toBe("API key");
		expect(providerSourceLabel({ source: "env", custom: false })).toBe("Environment Variables");
		expect(providerSourceLabel({ source: "custom", custom: true })).toBe("Custom");
		expect(providerSourceLabel({ source: "custom", custom: false })).toBe("System credentials");
	});
});

describe("isEnvironmentSourced", () => {
	it("treats autoloaded catalog providers as environment-sourced", () => {
		expect(isEnvironmentSourced({ source: "custom", custom: false, managed: false })).toBe(true);
		expect(isEnvironmentSourced({ source: "env", custom: false, managed: false })).toBe(true);
		expect(isEnvironmentSourced({ source: "api", custom: false, managed: false })).toBe(false);
		expect(isEnvironmentSourced({ source: "custom", custom: true, managed: false })).toBe(false);
		expect(isEnvironmentSourced({ source: "custom", custom: false, managed: true })).toBe(false);
	});
});
