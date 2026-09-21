import { describe, expect, it } from "vitest";

import {
	findDuplicate,
	generateProviderID,
	isCustomProviderPackage,
	MASKED_CUSTOM_PROVIDER_KEY,
	resolveCustomProviderAuth,
	resolveCustomProviderKey,
	resolveModalities,
	sanitizeCustomProviderConfig,
	validateProviderID,
	withCustomProviderDeletions,
} from "./custom-provider.js";

describe("generateProviderID", () => {
	it("creates a stable provider key from the display name", () => {
		expect(generateProviderID(" Local vLLM ", [])).toBe("local-vllm");
		expect(generateProviderID("Mistrál Cloud", [])).toBe("mistral-cloud");
	});

	it("avoids reserved and existing provider keys", () => {
		expect(generateProviderID("Kilo", [])).toBe("kilo-2");
		expect(generateProviderID("Anthropic", ["anthropic", "anthropic-2"])).toBe("anthropic-3");
	});
});

describe("isCustomProviderPackage", () => {
	it("recognizes supported custom provider packages", () => {
		expect(isCustomProviderPackage("@ai-sdk/openai-compatible")).toBe(true);
		expect(isCustomProviderPackage("@ai-sdk/openai")).toBe(true);
		expect(isCustomProviderPackage("@ai-sdk/anthropic")).toBe(true);
		expect(isCustomProviderPackage("malicious-package")).toBe(false);
	});
});

describe("findDuplicate", () => {
	it("finds duplicate normalized model ids", () => {
		expect(findDuplicate([" model-1 ", "model-1"])).toBe("model-1");
	});

	it("treats header names as case insensitive", () => {
		expect(findDuplicate(["Authorization", " authorization "], true)).toBe("authorization");
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

	it("rejects the reserved Kilo Gateway id", () => {
		const result = validateProviderID("kilo");
		expect("error" in result ? result.error : "").toBe("Provider ID is reserved");
	});

	it("rejects the managed local inference provider id", () => {
		const result = validateProviderID("kilo-desktop-model-server");
		expect("error" in result ? result.error : "").toBe("Provider ID is reserved");
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

describe("resolveModalities", () => {
	it("preserves non-image modalities when the image toggle is unchanged", () => {
		expect(
			resolveModalities({ input: ["text", "audio", "pdf"], output: ["text", "audio"] }, false),
		).toEqual({
			input: ["text", "audio", "pdf"],
			output: ["text", "audio"],
		});
	});

	it("removes only image input when image support is disabled", () => {
		expect(resolveModalities({ input: ["text", "image", "pdf"], output: ["text"] }, false)).toEqual(
			{
				input: ["text", "pdf"],
				output: ["text"],
			},
		);
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
					Authorization: " Bearer {env:AUTH_TOKEN} ",
					" X-Test ": " {env:X_TEST} ",
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
						Authorization: "Bearer {env:AUTH_TOKEN}",
						"X-Test": "{env:X_TEST}",
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

	it("allows plaintext custom header values", () => {
		const result = sanitizeCustomProviderConfig({
			name: "Literal headers",
			options: {
				baseURL: "https://example.com/v1",
				headers: { "X-Title": " My desktop app " },
			},
			models: { "model-1": { name: "Model One" } },
		});
		expect(result).toEqual({
			value: {
				npm: "@ai-sdk/openai-compatible",
				name: "Literal headers",
				options: {
					baseURL: "https://example.com/v1",
					headers: { "X-Title": "My desktop app" },
				},
				models: { "model-1": { name: "Model One" } },
			},
		});
	});

	it("allows custom header values that reference environment variables", () => {
		const result = sanitizeCustomProviderConfig({
			name: "Safe headers",
			options: {
				baseURL: "https://example.com/v1",
				headers: { Authorization: "Bearer {env:MY_API_TOKEN}" },
			},
			models: { "model-1": { name: "Model One" } },
		});
		expect(result).toEqual({
			value: {
				npm: "@ai-sdk/openai-compatible",
				name: "Safe headers",
				options: {
					baseURL: "https://example.com/v1",
					headers: { Authorization: "Bearer {env:MY_API_TOKEN}" },
				},
				models: { "model-1": { name: "Model One" } },
			},
		});
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

	it("emits null for headers removed from the next config", () => {
		const existing = {
			options: {
				baseURL: "https://example.com/v1",
				headers: { Authorization: "Bearer secret", "X-Keep": "old" },
			},
		};
		const result = withCustomProviderDeletions(existing, {
			...next,
			options: {
				...next.options,
				headers: { "X-Keep": "new" },
			},
		});
		expect(result.options.headers).toEqual({
			Authorization: null,
			"X-Keep": "new",
		});
	});

	it("clears the headers object when every header is removed", () => {
		const existing = {
			options: {
				baseURL: "https://example.com/v1",
				headers: { Authorization: "Bearer secret" },
			},
		};
		expect(withCustomProviderDeletions(existing, next).options.headers).toBeNull();
	});
});
