import { describe, expect, it } from "vitest";

import type { AiProvider } from "@kilo-desktop/plugin-core/contracts";

import {
	aiProviderSourceLabel,
	groupAiProviders,
	isEnvironmentSourced,
	POPULAR_AI_PROVIDER_IDS,
} from "./ai-provider-rows";

function provider(id: string, name: string, patch: Partial<AiProvider> = {}): AiProvider {
	return { id, name, connected: true, source: "api", env: [], canDisconnect: true, ...patch };
}

const byId = (...providers: AiProvider[]) =>
	Object.fromEntries(providers.map((entry) => [entry.id, entry]));

const ids = (providers: readonly AiProvider[]) => providers.map((entry) => entry.id);

describe("groupAiProviders", () => {
	it("lists connected AI providers alphabetically by name", () => {
		const { listed } = groupAiProviders(
			byId(
				provider("openai", "OpenAI"),
				provider("anthropic", "anthropic"),
				provider("groq", "Groq"),
			),
			new Set(),
		);
		expect(ids(listed)).toEqual(["anthropic", "groq", "openai"]);
	});

	it("lists environment and custom AI providers with the stored keys", () => {
		const { listed } = groupAiProviders(
			byId(
				provider("amazon-bedrock", "Amazon Bedrock", { source: "env", canDisconnect: false }),
				provider("vllm", "Local vLLM", { source: "custom" }),
			),
			new Set(),
		);
		expect(ids(listed)).toEqual(["amazon-bedrock", "vllm"]);
	});

	it("leaves out AI providers drawn by a panel and those managed elsewhere", () => {
		const { listed, popular } = groupAiProviders(
			byId(
				provider("kilo", "Kilo Gateway", { source: "kilo" }),
				provider("local-server", "Local Model Server", { source: "plugin" }),
				provider("featured", "Featured"),
				provider("anthropic", "Anthropic", { connected: false }),
				provider("openai", "OpenAI"),
			),
			new Set(["featured", "anthropic"]),
		);
		expect(ids(listed)).toEqual(["openai"]);
		expect(ids(popular)).toEqual([]);
	});

	it("offers popular AI providers that aren't connected, in their own order", () => {
		const { listed, popular } = groupAiProviders(
			byId(
				provider("vercel", "Vercel", { connected: false }),
				provider("anthropic", "Anthropic", { connected: false }),
				provider("openai", "OpenAI"),
				provider("groq", "Groq", { connected: false }),
			),
			new Set(),
		);
		expect(ids(listed)).toEqual(["openai"]);
		expect(ids(popular)).toEqual(["anthropic", "vercel"]);
		expect(POPULAR_AI_PROVIDER_IDS).not.toContain("kilo");
	});
});

describe("aiProviderSourceLabel", () => {
	it("labels stored keys, env vars, custom endpoints and autoloaded credentials distinctly", () => {
		expect(aiProviderSourceLabel({ source: "api" })).toBe("API key");
		expect(aiProviderSourceLabel({ source: "env" })).toBe("Environment Variables");
		expect(aiProviderSourceLabel({ source: "custom" })).toBe("Custom");
		expect(aiProviderSourceLabel({ source: "config" })).toBe("System credentials");
		expect(aiProviderSourceLabel({})).toBe("System credentials");
	});
});

describe("isEnvironmentSourced", () => {
	it("treats environment and config credentials as environment-sourced", () => {
		expect(isEnvironmentSourced({ source: "env" })).toBe(true);
		expect(isEnvironmentSourced({ source: "config" })).toBe(true);
		expect(isEnvironmentSourced({ source: "api" })).toBe(false);
		expect(isEnvironmentSourced({ source: "custom" })).toBe(false);
	});
});
