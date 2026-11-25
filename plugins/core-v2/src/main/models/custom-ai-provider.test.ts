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
			package: "@ai-sdk/anthropic",
			name: " My Provider ",
			settings: { baseURL: "https://example.com/v1 ", apiKey: "sk-should-never-appear" },
			headers: {
				Authorization: " Bearer {env:AUTH_TOKEN} ",
				" X-Test ": " {env:X_TEST} ",
			},
			models: { " model-1 ": { name: " Model One ", limit: { context: 8_000, output: 0 } } },
		});

		expect(result).toEqual({
			value: {
				package: "@ai-sdk/anthropic",
				name: "My Provider",
				settings: { baseURL: "https://example.com/v1" },
				headers: { Authorization: "Bearer {env:AUTH_TOKEN}", "X-Test": "{env:X_TEST}" },
				models: { "model-1": { name: "Model One", limit: { context: 8_000, output: 0 } } },
			},
		});
		expect(JSON.stringify(result)).not.toContain("sk-should-never-appear");
	});

	it("defaults the package to openai-compatible", () => {
		const capabilities = {
			reasoning: { supported: true },
			input: ["text", "image"],
			output: ["text"],
		};
		const result = sanitizeKiloProviderEntry({
			name: "Thinking Provider",
			settings: { baseURL: "https://example.com/v1" },
			models: { "model-1": { name: "Model One", capabilities } },
		});
		expect(result).toEqual({
			value: {
				package: "@ai-sdk/openai-compatible",
				name: "Thinking Provider",
				settings: { baseURL: "https://example.com/v1" },
				models: { "model-1": { name: "Model One", capabilities } },
			},
		});
	});

	it.each([
		["an unapproved package", { package: "malicious-package" }],
		["a missing model list", { models: {} }],
		["a non-http base URL", { settings: { baseURL: "ftp://example.com/v1" } }],
	])("rejects %s", (_name, patch) => {
		const result = sanitizeKiloProviderEntry({
			name: "Provider",
			settings: { baseURL: "https://example.com/v1" },
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
				package: "@ai-sdk/openai-compatible",
				name: "Local vLLM",
				settings: { baseURL: "http://127.0.0.1:8000/v1" },
				headers: { "X-Title": "Desktop" },
				models: {
					llama: {
						name: "Llama",
						capabilities: {
							reasoning: { supported: true },
							input: ["text", "image"],
							output: ["text"],
						},
						limit: { context: 128_000, output: 8_000 },
					},
					small: { name: "Small", limit: { context: 4_096, output: 0 } },
				},
			},
		});
	});

	it("keeps the existing package and the modalities attachments don't decide", () => {
		const existing = {
			package: "@ai-sdk/anthropic",
			models: {
				a: { name: "A", capabilities: { input: ["text", "pdf", "image"], output: ["text"] } },
				b: { name: "B", capabilities: { input: ["text", "audio"], output: ["text"] } },
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
				package: "@ai-sdk/anthropic",
				name: "Acme",
				settings: { baseURL: "https://acme.test/v1" },
				models: {
					a: { name: "A", capabilities: { input: ["text", "pdf"], output: ["text"] } },
					b: { name: "B", capabilities: { input: ["text", "audio"], output: ["text"] } },
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
		const existing = { package: "@ai-sdk/openai-compatible" };
		const packageOf = (apiFormat: "openai-responses" | "anthropic-messages") => {
			const result = toKiloProviderEntry({ ...provider, apiFormat }, existing);
			return "value" in result ? result.value.package : result.error;
		};
		expect(packageOf("openai-responses")).toBe("@ai-sdk/openai");
		expect(packageOf("anthropic-messages")).toBe("@ai-sdk/anthropic");
		expect(
			fromKiloProviderEntry(
				"acme",
				{
					...existing,
					package: "@ai-sdk/anthropic",
					name: "Acme",
					settings: { baseURL: "https://acme.test/v1" },
					models: { a: { name: "A" } },
				},
				false,
			)?.apiFormat,
		).toBe("anthropic-messages");
	});
});

describe("fromKiloProviderEntry", () => {
	const entry = {
		package: "@ai-sdk/openai-compatible",
		name: "Local vLLM",
		settings: { baseURL: "http://127.0.0.1:8000/v1" },
		headers: { "X-Title": "Desktop" },
		models: {
			llama: {
				name: "Llama",
				capabilities: {
					reasoning: { supported: true },
					input: ["text", "image"],
					output: ["text"],
				},
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
		expect(fromKiloProviderEntry("openai", { settings: { apiKey: "x" } }, true)).toBeNull();
		expect(fromKiloProviderEntry("vllm", undefined, false)).toBeNull();
	});
});

describe("withCustomProviderDeletions", () => {
	const next = {
		package: "@ai-sdk/openai-compatible" as const,
		name: "My Provider",
		settings: { baseURL: "https://example.com/v1" },
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

	it("emits null when capabilities or limits are dropped from a surviving model", () => {
		const existing = {
			models: {
				keep: {
					name: "Keep",
					capabilities: { reasoning: { supported: true }, input: ["text"] },
					limit: { context: 1, output: 1 },
				},
				odd: "not a model",
			},
		};
		expect(withCustomProviderDeletions(existing, next).models.keep).toEqual({
			name: "Keep",
			capabilities: null,
			limit: null,
		});
	});

	it("emits null for the capabilities a surviving model no longer has", () => {
		const existing = {
			models: {
				keep: { name: "Keep", capabilities: { reasoning: { supported: true }, input: ["text"] } },
			},
		};
		const result = withCustomProviderDeletions(existing, {
			...next,
			models: { keep: { name: "Keep", capabilities: { input: ["text", "image"] } } },
		});
		expect(result.models.keep).toEqual({
			name: "Keep",
			capabilities: { reasoning: null, input: ["text", "image"] },
		});
	});

	it("emits null for headers removed from the next config", () => {
		const existing = { headers: { Authorization: "Bearer secret", "X-Keep": "old" } };
		const result = withCustomProviderDeletions(existing, {
			...next,
			headers: { "X-Keep": "new" },
		});
		expect(result.headers).toEqual({ Authorization: null, "X-Keep": "new" });
	});

	it("clears the headers object when every header is removed", () => {
		const existing = { headers: { Authorization: "Bearer secret" } };
		expect(withCustomProviderDeletions(existing, next).headers).toBeNull();
	});
});
