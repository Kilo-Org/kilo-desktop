import { describe, expect, it } from "vitest";

import {
	isCustomProviderPackage,
	MASKED_CUSTOM_PROVIDER_KEY,
	resolveCustomProviderAuth,
	resolveCustomProviderKey,
	sanitizeCustomProviderConfig,
	validateProviderID,
	withCustomProviderDeletions,
} from "./custom-provider.js";

describe("isCustomProviderPackage", () => {
	it("recognizes supported custom provider packages", () => {
		expect(isCustomProviderPackage("@ai-sdk/openai-compatible")).toBe(true);
		expect(isCustomProviderPackage("@ai-sdk/openai")).toBe(true);
		expect(isCustomProviderPackage("@ai-sdk/anthropic")).toBe(true);
		expect(isCustomProviderPackage("malicious-package")).toBe(false);
	});
});

describe("validateProviderID", () => {
	it("accepts a trimmed lowercase id", () => {
		expect(validateProviderID(" my-provider_1 ")).toEqual({ value: "my-provider_1" });
	});

	it("rejects ids with a slash", () => {
		const result = validateProviderID("bad/id");
		expect("error" in result ? result.error : "").toBe("Invalid provider ID");
	});
});

describe("resolveCustomProviderAuth", () => {
	it("preserves auth when the api key field is unchanged", () => {
		expect(resolveCustomProviderAuth(undefined, false)).toEqual({ mode: "preserve" });
	});

	it("stores a changed api key without putting it in the config patch", () => {
		expect(resolveCustomProviderAuth(" sk-test ", true)).toEqual({ mode: "set", key: "sk-test" });
	});

	it("clears auth when the field was changed to empty", () => {
		expect(resolveCustomProviderAuth(undefined, true)).toEqual({ mode: "clear" });
	});
});

describe("resolveCustomProviderKey", () => {
	it("masks a stored api key in the edit form", () => {
		expect(resolveCustomProviderKey("api")).toBe(MASKED_CUSTOM_PROVIDER_KEY);
	});

	it("hides oauth credentials from the edit form", () => {
		expect(resolveCustomProviderKey("oauth")).toBe("");
	});
});

describe("sanitizeCustomProviderConfig", () => {
	it("normalizes a valid openai-compatible block and omits secrets", () => {
		const result = sanitizeCustomProviderConfig({
			npm: "@ai-sdk/anthropic",
			name: " My Provider ",
			options: {
				baseURL: "https://example.com/v1 ",
				headers: {
					Authorization: " Bearer test ",
					" X-Test ": " 123 ",
				},
				apiKey: "sk-should-never-appear",
			},
			models: {
				" model-1 ": { name: " Model One " },
			},
		});

		expect(result).toEqual({
			value: {
				npm: "@ai-sdk/anthropic",
				name: "My Provider",
				options: {
					baseURL: "https://example.com/v1",
					headers: {
						Authorization: "Bearer test",
						"X-Test": "123",
					},
				},
				models: {
					"model-1": { name: "Model One" },
				},
			},
		});
		if (!("value" in result)) throw new Error("expected sanitized config");
		expect(JSON.stringify(result.value)).not.toContain("sk-should-never-appear");
		expect(JSON.stringify(result.value)).not.toContain("apiKey");
	});

	it("rejects an unapproved npm package", () => {
		const result = sanitizeCustomProviderConfig({
			npm: "malicious-package",
			name: "Bad Provider",
			options: { baseURL: "https://example.com/v1" },
			models: { "model-1": { name: "Model One" } },
		});
		expect("error" in result).toBe(true);
	});

	it("rejects a missing model list", () => {
		const result = sanitizeCustomProviderConfig({
			name: "Empty",
			options: { baseURL: "https://example.com/v1" },
			models: {},
		});
		expect("error" in result).toBe(true);
	});

	it("rejects a non-http base URL", () => {
		const result = sanitizeCustomProviderConfig({
			name: "Ftp",
			options: { baseURL: "ftp://example.com/v1" },
			models: { "model-1": { name: "Model One" } },
		});
		expect("error" in result).toBe(true);
	});

	it("defaults npm to openai-compatible", () => {
		const result = sanitizeCustomProviderConfig({
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

	it("emits null when reasoning is dropped from a surviving model", () => {
		const existing = { models: { keep: { name: "Keep", reasoning: true } } };
		expect(withCustomProviderDeletions(existing, next).models.keep).toEqual({
			name: "Keep",
			reasoning: null,
		});
	});
});
