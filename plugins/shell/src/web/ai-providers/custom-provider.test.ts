import { describe, expect, it } from "vitest";

import {
	emptyForm,
	findDuplicate,
	formFromCustomAiProvider,
	generateProviderID,
	toCustomAiProvider,
	validateHeaders,
	type CustomProviderFormState,
} from "./custom-provider";

const row = (id: string, patch: { reasoning?: boolean; supportsImages?: boolean } = {}) => ({
	rowID: id,
	id,
	reasoning: patch.reasoning ?? false,
	supportsImages: patch.supportsImages ?? false,
});

const FILLED: CustomProviderFormState = {
	...emptyForm(),
	name: " Local vLLM ",
	baseURL: " http://127.0.0.1:8000/v1 ",
	models: [row(" qwen ", { reasoning: true })],
};

describe("generateProviderID", () => {
	it("creates a stable provider key from the display name", () => {
		expect(generateProviderID(" Local vLLM ", [])).toBe("local-vllm");
		expect(generateProviderID("Mistrál Cloud", [])).toBe("mistral-cloud");
		expect(generateProviderID("!!!", [])).toBe("custom-provider");
	});

	it("avoids reserved and existing provider keys", () => {
		expect(generateProviderID("Kilo", [])).toBe("kilo-2");
		expect(generateProviderID("Anthropic", ["anthropic", "anthropic-2"])).toBe("anthropic-3");
	});
});

describe("findDuplicate", () => {
	it("finds duplicate normalized model ids", () => {
		expect(findDuplicate([" model-1 ", "model-1"])).toBe("model-1");
		expect(findDuplicate(["a", "", " ", "b"])).toBeUndefined();
	});

	it("treats header names as case insensitive", () => {
		expect(findDuplicate(["Authorization", " authorization "], true)).toBe("authorization");
	});
});

describe("validateHeaders", () => {
	it("needs both a name and a value, once per name", () => {
		expect(validateHeaders([{ rowID: "1", key: "A", value: "1" }])).toBeNull();
		expect(validateHeaders([{ rowID: "1", key: "Authorization", value: " " }])).toBe(
			"Header name and value are both required",
		);
		expect(
			validateHeaders([
				{ rowID: "1", key: "X-Key", value: "1" },
				{ rowID: "2", key: "x-key", value: "2" },
			]),
		).toBe('Header "x-key" is duplicated');
	});
});

describe("toCustomAiProvider", () => {
	it("converts a filled-in form, trimmed, with the key change as the contract reads it", () => {
		expect(
			toCustomAiProvider(
				{
					...FILLED,
					apiFormat: "anthropic-messages",
					headers: [{ rowID: "h", key: " X-Title ", value: " Desktop " }],
				},
				{ aiProviderId: "local-vllm", apiKey: "sk-test" },
			),
		).toEqual({
			value: {
				aiProviderId: "local-vllm",
				name: "Local vLLM",
				baseUrl: "http://127.0.0.1:8000/v1",
				apiFormat: "anthropic-messages",
				apiKey: "sk-test",
				headers: { "X-Title": "Desktop" },
				models: [{ modelId: "qwen", name: "qwen", reasoning: true, attachments: false }],
			},
		});
	});

	it("keeps the stored key when the key wasn't changed", () => {
		const result = toCustomAiProvider(FILLED, { aiProviderId: "vllm", apiKey: undefined });
		expect("value" in result && result.value).not.toHaveProperty("apiKey");
	});

	it.each([
		["a missing name", { name: " " }, "Enter a provider name"],
		[
			"a non-http base URL",
			{ baseURL: "ftp://example.com/v1" },
			"Base URL must start with http:// or https://",
		],
		[
			"an unparseable base URL",
			{ baseURL: "not a url" },
			"Base URL must start with http:// or https://",
		],
		["no models", { models: [row(" ")] }, "At least one model is required"],
	])("rejects %s", (_name, patch, error) => {
		expect(
			toCustomAiProvider({ ...FILLED, ...patch }, { aiProviderId: "vllm", apiKey: undefined }),
		).toEqual({ error });
	});

	it("rejects what kilo.core's contract would", () => {
		const result = toCustomAiProvider(FILLED, { aiProviderId: "Bad ID", apiKey: undefined });
		expect(result).toHaveProperty("error");
	});
});

describe("formFromCustomAiProvider", () => {
	it("fills the form from a saved provider, keeping model limits, with an empty key", () => {
		const form = formFromCustomAiProvider({
			aiProviderId: "vllm",
			name: "Local vLLM",
			baseUrl: "http://127.0.0.1:8000/v1",
			apiKey: "********",
			headers: { "X-Title": "Desktop" },
			models: [
				{
					modelId: "llama",
					name: "Llama",
					reasoning: true,
					attachments: true,
					contextWindow: 128_000,
				},
				{ modelId: "small", name: "Small", maxOutputTokens: 4_096 },
			],
		});
		expect(form).toMatchObject({
			name: "Local vLLM",
			apiFormat: "openai-compatible",
			baseURL: "http://127.0.0.1:8000/v1",
			apiKey: "",
			headers: [{ key: "X-Title", value: "Desktop" }],
			models: [
				{ id: "llama", reasoning: true, supportsImages: true, contextWindow: 128_000 },
				{ id: "small", reasoning: false, supportsImages: false, maxOutputTokens: 4_096 },
			],
		});
		const saved = toCustomAiProvider(form, { aiProviderId: "vllm", apiKey: undefined });
		expect("value" in saved && saved.value.models).toEqual([
			{
				modelId: "llama",
				name: "Llama",
				reasoning: true,
				attachments: true,
				contextWindow: 128_000,
			},
			{
				modelId: "small",
				name: "Small",
				reasoning: false,
				attachments: false,
				maxOutputTokens: 4_096,
			},
		]);
	});
});
