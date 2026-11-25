import { describe, expect, it } from "vitest";

import {
	connectAiProvider,
	disconnectAiProvider,
	readCustomAiProvider,
	saveCustomAiProvider,
} from "./ai-provider-mutations";
import { MASKED_API_KEY } from "./custom-ai-provider";
import { createFakeKiloClient, integration } from "./test-kilo-client";

const custom = {
	aiProviderId: "my-provider",
	name: "My Provider",
	baseUrl: "https://example.com/v1",
	models: [{ modelId: "model-1", name: "Model One" }],
};

describe("connectAiProvider", () => {
	it("stores the key then reloads so the AI providers pick it up", async () => {
		const fake = createFakeKiloClient();
		await connectAiProvider(fake.client, "anthropic", " sk-ant ");
		expect(fake.calls.set).toEqual([{ aiProviderId: "anthropic", key: "sk-ant" }]);
		expect(fake.calls.order).toEqual(["set", "reload"]);
	});
});

describe("disconnectAiProvider", () => {
	it("removes the key and reloads for a catalog AI provider", async () => {
		const fake = createFakeKiloClient();
		await disconnectAiProvider(fake.client, "anthropic");
		expect(fake.calls.remove).toEqual(["anthropic"]);
		expect(fake.calls.update).toEqual([]);
		expect(fake.calls.reload).toBe(1);
	});

	it("deletes a custom provider's entry", async () => {
		const fake = createFakeKiloClient({
			config: {
				providers: {
					vllm: {
						package: "@ai-sdk/openai-compatible",
						name: "vLLM",
						settings: { baseURL: "http://127.0.0.1:8000/v1" },
					},
				},
			},
		});
		await disconnectAiProvider(fake.client, "vllm");
		expect(fake.calls.remove).toEqual(["vllm"]);
		expect(fake.calls.update).toEqual([{ providers: { vllm: null } }]);
		expect(fake.config.providers).toEqual({});
		expect(fake.calls.reload).toBe(1);
	});

	it("keeps the custom entry when removing the key fails", async () => {
		const fake = createFakeKiloClient({
			config: { providers: { vllm: { package: "@ai-sdk/openai-compatible" } } },
		});
		fake.client.removeApiKey = async () => {
			throw new Error("credential store unavailable");
		};
		await expect(disconnectAiProvider(fake.client, "vllm")).rejects.toThrow(
			"credential store unavailable",
		);
		expect(fake.calls.update).toEqual([]);
		expect(fake.calls.reload).toBe(0);
	});
});

describe("saveCustomAiProvider", () => {
	it("writes the entry, then stores the key against the integration Kilo made from it", async () => {
		const fake = createFakeKiloClient();
		await saveCustomAiProvider(fake.client, { ...custom, apiKey: " sk-test " });
		expect(fake.config.providers).toEqual({
			"my-provider": {
				package: "@ai-sdk/openai-compatible",
				name: "My Provider",
				settings: { baseURL: "https://example.com/v1" },
				models: { "model-1": { name: "Model One" } },
			},
		});
		expect(JSON.stringify(fake.calls.update)).not.toContain("sk-test");
		expect(fake.calls.set).toEqual([{ aiProviderId: "my-provider", key: "sk-test" }]);
		expect(fake.calls.order).toEqual(["update", "reload", "set", "reload"]);
	});

	it("keeps the saved entry when storing the key fails, so it can be edited again", async () => {
		const fake = createFakeKiloClient();
		fake.client.setApiKey = async () => {
			throw new Error("credential store unavailable");
		};
		await expect(
			saveCustomAiProvider(fake.client, { ...custom, apiKey: "sk-test" }),
		).rejects.toThrow("credential store unavailable");
		expect(Object.keys(fake.config.providers ?? {})).toEqual(["my-provider"]);
	});

	it("keeps the stored key when the key is omitted or masked, and deletes removed models", async () => {
		const fake = createFakeKiloClient({
			config: {
				providers: {
					"my-provider": {
						package: "@ai-sdk/openai-compatible",
						models: { gone: { name: "Gone" }, "model-1": { name: "Old" } },
					},
				},
			},
		});
		await saveCustomAiProvider(fake.client, custom);
		await saveCustomAiProvider(fake.client, { ...custom, apiKey: MASKED_API_KEY });

		expect(fake.config.providers?.["my-provider"]).toMatchObject({
			models: { "model-1": { name: "Model One" } },
		});
		expect(fake.config.providers?.["my-provider"]).not.toHaveProperty(["models", "gone"]);
		expect(fake.calls.set).toEqual([]);
		expect(fake.calls.remove).toEqual([]);
		expect(fake.calls.reload).toBe(2);
	});

	it("removes the stored key when the key is emptied", async () => {
		const fake = createFakeKiloClient();
		await saveCustomAiProvider(fake.client, { ...custom, apiKey: "" });
		expect(fake.calls.set).toEqual([]);
		expect(fake.calls.remove).toEqual(["my-provider"]);
	});

	it("refuses an entry Kilo couldn't load", async () => {
		const fake = createFakeKiloClient();
		await expect(
			saveCustomAiProvider(fake.client, { ...custom, baseUrl: "ftp://example.com/v1" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(fake.calls.order).toEqual([]);
	});
});

describe("readCustomAiProvider", () => {
	it("reads a custom provider back, masking its stored key", async () => {
		const fake = createFakeKiloClient({
			config: {
				providers: {
					vllm: {
						package: "@ai-sdk/openai-compatible",
						name: "vLLM",
						settings: { baseURL: "http://127.0.0.1:8000/v1" },
						models: { llama: { name: "Llama" } },
					},
				},
			},
			catalog: { integrations: [integration("vllm", { connections: [{ type: "credential" }] })] },
		});
		await expect(readCustomAiProvider(fake.client, "vllm")).resolves.toEqual({
			aiProviderId: "vllm",
			name: "vLLM",
			baseUrl: "http://127.0.0.1:8000/v1",
			apiFormat: "openai-compatible",
			apiKey: MASKED_API_KEY,
			models: [{ modelId: "llama", name: "Llama" }],
		});
		await expect(readCustomAiProvider(fake.client, "openai")).resolves.toBeNull();
	});
});
