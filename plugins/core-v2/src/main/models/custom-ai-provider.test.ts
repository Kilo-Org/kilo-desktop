import { describe, expect, it } from "vitest";

import {
	fromKiloProviderEntry,
	isCustomProviderPackage,
	MASKED_API_KEY,
	sanitizeKiloProviderEntry,
	toKiloProviderEntry,
	withCustomProviderDeletions,
} from "./custom-ai-provider";

describe("isCustomProviderPackage", () => {
	it("recognizes supported custom provider packages", () => {
		expect(isCustomProviderPackage("@ai-sdk/openai-compatible")).toBe(true);
		expect(isCustomProviderPackage("@ai-sdk/openai")).toBe(true);
		expect(isCustomProviderPackage("@ai-sdk/anthropic")).toBe(true);
		expect(isCustomProviderPackage("malicious-package")).toBe(false);
	});
});

describe("sanitizeKiloProviderEntry", () => {
	it("normalizes a valid block and omits secrets", () => {
		const result = sanitizeKiloProviderEntry({
			npm: "@ai-sdk/anthropic",
			name: " My Provider ",
			options: {
				baseURL: "https://example.com/v1 ",
				headers: {
					Authorization: " Bearer {env:AUTH_TOKEN} ",
					" X-Test ": " {env:X_TEST} ",
				},
				apiKey: "sk-should-never-appear",
			},
			models: { " model-1 ": { name: " Model One ", limit: { context: 8_000, output: 0 } } },
		});

		expect(result).toEqual({
			value: {
				npm: "@ai-sdk/anthropic",
				name: "My Provider",
				options: {
					baseURL: "https://example.com/v1",
					headers: { Authorization: "Bearer {env:AUTH_TOKEN}", "X-Test": "{env:X_TEST}" },
				},
				models: { "model-1": { name: "Model One", limit: { context: 8_000, output: 0 } } },
			},
		});
		expect(JSON.stringify(result)).not.toContain("sk-should-never-appear");
	});

	it("defaults npm to openai-compatible", () => {
		const result = sanitizeKiloProviderEntry({
			name: "Thinking Provider",
			options: { baseURL: "https://example.com/v1" },
			models: {
				"model-1": {
					name: "Model One",
					reasoning: true,
					modalities: { input: ["text", "image"], output: ["text"] },
				},
			},
		});
		expect(result).toEqual({
			value: {
				npm: "@ai-sdk/openai-compatible",
				name: "Thinking Provider",
				options: { baseURL: "https://example.com/v1" },
				models: {
					"model-1": {
						name: "Model One",
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
					},
				},
			},
		});
	});

	it.each([
		["an unapproved npm package", { npm: "malicious-package" }],
		["a missing model list", { models: {} }],
		["a non-http base URL", { options: { baseURL: "ftp://example.com/v1" } }],
	])("rejects %s", (_name, patch) => {
		const result = sanitizeKiloProviderEntry({
			name: "Provider",
			options: { baseURL: "https://example.com/v1" },
			models: { "model-1": { name: "Model One" } },
			...patch,
		});
		expect("error" in result).toBe(true);
	});

	it("rejects a value that is not an object", () => {
		expect("error" in sanitizeKiloProviderEntry(null)).toBe(true);
	});
});

describe("toKiloProviderEntry", () => {
	it("writes an OpenAI-compatible entry with headers, modalities and limits", () => {
		expect(
			toKiloProviderEntry(
				{
					aiProviderId: "vllm",
					name: " Local vLLM ",
					baseUrl: "http://127.0.0.1:8000/v1",
					headers: { "X-Title": " Desktop " },
					models: [
						{
							modelId: " llama ",
							name: "Llama",
							reasoning: true,
							attachments: true,
							contextWindow: 128_000,
							maxOutputTokens: 8_000,
						},
						{ modelId: "small", name: "Small", contextWindow: 4_096 },
					],
				},
				undefined,
			),
		).toEqual({
			value: {
				npm: "@ai-sdk/openai-compatible",
				name: "Local vLLM",
				options: { baseURL: "http://127.0.0.1:8000/v1", headers: { "X-Title": "Desktop" } },
				models: {
					llama: {
						name: "Llama",
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 128_000, output: 8_000 },
					},
					small: { name: "Small", limit: { context: 4_096, output: 0 } },
				},
			},
		});
	});

	it("keeps the existing package and the modalities attachments don't decide", () => {
		const existing = {
			npm: "@ai-sdk/anthropic",
			models: {
				a: { name: "A", modalities: { input: ["text", "pdf", "image"], output: ["text"] } },
				b: { name: "B", modalities: { input: ["text", "audio"], output: ["text"] } },
			},
		};
		expect(
			toKiloProviderEntry(
				{
					aiProviderId: "acme",
					name: "Acme",
					baseUrl: "https://acme.test/v1",
					models: [
						{ modelId: "a", name: "A", attachments: false },
						{ modelId: "b", name: "B" },
					],
				},
				existing,
			),
		).toEqual({
			value: {
				npm: "@ai-sdk/anthropic",
				name: "Acme",
				options: { baseURL: "https://acme.test/v1" },
				models: {
					a: { name: "A", modalities: { input: ["text", "pdf"], output: ["text"] } },
					b: { name: "B", modalities: { input: ["text", "audio"], output: ["text"] } },
				},
			},
		});
	});

	it("writes the package of a chosen API format, over the existing one", () => {
		const provider = {
			aiProviderId: "acme",
			name: "Acme",
			baseUrl: "https://acme.test/v1",
			models: [{ modelId: "a", name: "A" }],
		};
		const existing = { npm: "@ai-sdk/openai-compatible" };
		const npm = (apiFormat: "openai-responses" | "anthropic-messages") => {
			const result = toKiloProviderEntry({ ...provider, apiFormat }, existing);
			return "value" in result ? result.value.npm : result.error;
		};
		expect(npm("openai-responses")).toBe("@ai-sdk/openai");
		expect(npm("anthropic-messages")).toBe("@ai-sdk/anthropic");
		expect(
			fromKiloProviderEntry(
				"acme",
				{
					...existing,
					npm: "@ai-sdk/anthropic",
					name: "Acme",
					options: { baseURL: "https://acme.test/v1" },
					models: { a: { name: "A" } },
				},
				false,
			)?.apiFormat,
		).toBe("anthropic-messages");
	});
});

describe("fromKiloProviderEntry", () => {
	const entry = {
		npm: "@ai-sdk/openai-compatible",
		name: "Local vLLM",
		options: { baseURL: "http://127.0.0.1:8000/v1", headers: { "X-Title": "Desktop" } },
		models: {
			llama: {
				name: "Llama",
				reasoning: true,
				modalities: { input: ["text", "image"], output: ["text"] },
				limit: { context: 128_000, output: 0 },
			},
		},
	};

	it("reads a custom entry back for editing, masking a stored key", () => {
		expect(fromKiloProviderEntry("vllm", entry, true)).toEqual({
			aiProviderId: "vllm",
			name: "Local vLLM",
			baseUrl: "http://127.0.0.1:8000/v1",
			apiFormat: "openai-compatible",
			apiKey: MASKED_API_KEY,
			headers: { "X-Title": "Desktop" },
			models: [
				{
					modelId: "llama",
					name: "Llama",
					reasoning: true,
					attachments: true,
					contextWindow: 128_000,
				},
			],
		});
	});

	it("omits the key when none is stored", () => {
		expect(fromKiloProviderEntry("vllm", entry, false)).not.toHaveProperty("apiKey");
	});

	it("reads nothing from an entry that isn't a valid custom provider", () => {
		expect(fromKiloProviderEntry("openai", { options: { apiKey: "x" } }, true)).toBeNull();
		expect(fromKiloProviderEntry("vllm", undefined, false)).toBeNull();
	});
});

describe("withCustomProviderDeletions", () => {
	const next = {
		npm: "@ai-sdk/openai-compatible" as const,
		name: "My Provider",
		options: { baseURL: "https://example.com/v1" },
		models: { keep: { name: "Keep" } },
	};

	it("passes through when there is no prior config", () => {
		expect(withCustomProviderDeletions(undefined, next)).toEqual(next);
	});

	it("emits null for models removed from the next config", () => {
		const existing = { models: { keep: { name: "Keep" }, gone: { name: "Gone" } } };
		const result = withCustomProviderDeletions(existing, next);
		expect(result.models.keep).toEqual({ name: "Keep" });
		expect(result.models.gone).toBeNull();
	});

	it("emits null when reasoning, modalities or limits are dropped from a surviving model", () => {
		const existing = {
			models: {
				keep: {
					name: "Keep",
					reasoning: true,
					modalities: { input: ["text"] },
					limit: { context: 1, output: 1 },
				},
				odd: "not a model",
			},
		};
		expect(withCustomProviderDeletions(existing, next).models.keep).toEqual({
			name: "Keep",
			reasoning: null,
			modalities: null,
			limit: null,
		});
	});

	it("emits null for headers removed from the next config", () => {
		const existing = {
			options: {
				baseURL: "https://example.com/v1",
				headers: { Authorization: "Bearer secret", "X-Keep": "old" },
			},
		};
		const result = withCustomProviderDeletions(existing, {
			...next,
			options: { ...next.options, headers: { "X-Keep": "new" } },
		});
		expect(result.options.headers).toEqual({ Authorization: null, "X-Keep": "new" });
	});

	it("clears the headers object when every header is removed", () => {
		const existing = {
			options: { baseURL: "https://example.com/v1", headers: { Authorization: "Bearer secret" } },
		};
		expect(withCustomProviderDeletions(existing, next).options.headers).toBeNull();
	});
});
