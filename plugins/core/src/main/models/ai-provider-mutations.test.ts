import { describe, expect, it } from "vitest";

import {
	connectAiProvider,
	disconnectAiProvider,
	readCustomAiProvider,
	saveCustomAiProvider,
} from "./ai-provider-mutations";
import { MASKED_API_KEY } from "./custom-ai-provider";
import { createFakeKiloClient } from "./test-kilo-client";

const custom = {
	aiProviderId: "my-provider",
	name: "My Provider",
	baseUrl: "https://example.com/v1",
	models: [{ modelId: "model-1", name: "Model One" }],
};

describe("connectAiProvider", () => {
	it("stores the key then disposes so the AI providers reload", async () => {
		const fake = createFakeKiloClient();
		await connectAiProvider(fake.client, "anthropic", " sk-ant ");
		expect(fake.calls.set).toEqual([{ aiProviderId: "anthropic", key: "sk-ant" }]);
		expect(fake.calls.dispose).toBe(1);
	});
});

describe("disconnectAiProvider", () => {
	it("removes the key and disposes for a catalog AI provider", async () => {
		const fake = createFakeKiloClient();
		await disconnectAiProvider(fake.client, "anthropic");
		expect(fake.calls.remove).toEqual(["anthropic"]);
		expect(fake.calls.update).toEqual([]);
		expect(fake.calls.dispose).toBe(1);
	});

	it("deletes a custom provider's entry with a null sentinel", async () => {
		const fake = createFakeKiloClient({
			config: {
				provider: {
					vllm: {
						npm: "@ai-sdk/openai-compatible",
						name: "vLLM",
						options: { baseURL: "http://127.0.0.1:8000/v1" },
					},
				},
			},
		});
		await disconnectAiProvider(fake.client, "vllm");
		expect(fake.calls.remove).toEqual(["vllm"]);
		expect(fake.calls.update).toEqual([{ provider: { vllm: null } }]);
		expect(fake.calls.dispose).toBe(1);
	});

	it("keeps the custom entry when removing the key fails", async () => {
		const fake = createFakeKiloClient({
			config: { provider: { vllm: { npm: "@ai-sdk/openai-compatible" } } },
		});
		fake.client.removeApiKey = async () => {
			throw new Error("credential store unavailable");
		};
		await expect(disconnectAiProvider(fake.client, "vllm")).rejects.toThrow(
			"credential store unavailable",
		);
		expect(fake.calls.update).toEqual([]);
		expect(fake.calls.dispose).toBe(0);
	});
});

describe("saveCustomAiProvider", () => {
	it("stores the key before writing the entry and never puts the key in config", async () => {
		const fake = createFakeKiloClient();
		await saveCustomAiProvider(fake.client, { ...custom, apiKey: " sk-test " });
		expect(fake.calls.update).toEqual([
			{
				provider: {
					"my-provider": {
						npm: "@ai-sdk/openai-compatible",
						name: "My Provider",
						options: { baseURL: "https://example.com/v1" },
						models: { "model-1": { name: "Model One" } },
					},
				},
			},
		]);
		expect(JSON.stringify(fake.calls.update)).not.toContain("sk-test");
		expect(fake.calls.set).toEqual([{ aiProviderId: "my-provider", key: "sk-test" }]);
		expect(fake.calls.order).toEqual(["set", "update"]);
		expect(fake.calls.dispose).toBe(1);
	});

	it("doesn't write config when storing the key fails", async () => {
		const fake = createFakeKiloClient();
		fake.client.setApiKey = async () => {
			throw new Error("credential store unavailable");
		};
		await expect(
			saveCustomAiProvider(fake.client, { ...custom, apiKey: "sk-test" }),
		).rejects.toThrow("credential store unavailable");
		expect(fake.calls.update).toEqual([]);
		expect(fake.calls.dispose).toBe(0);
	});

	it("keeps the stored key when the key is omitted or masked, and nulls removed models", async () => {
		const fake = createFakeKiloClient({
			config: {
				provider: {
					"my-provider": {
						npm: "@ai-sdk/openai-compatible",
						models: { gone: { name: "Gone" }, "model-1": { name: "Old" } },
					},
				},
			},
		});
		await saveCustomAiProvider(fake.client, custom);
		await saveCustomAiProvider(fake.client, { ...custom, apiKey: MASKED_API_KEY });

		const patch = fake.calls.update[0]?.provider?.["my-provider"] as {
			models: Record<string, unknown>;
		};
		expect(patch.models["model-1"]).toEqual({ name: "Model One" });
		expect(patch.models.gone).toBeNull();
		expect(fake.calls.set).toEqual([]);
		expect(fake.calls.remove).toEqual([]);
		expect(fake.calls.dispose).toBe(2);
	});

	it("removes the stored key when the key is emptied", async () => {
		const fake = createFakeKiloClient();
		await saveCustomAiProvider(fake.client, { ...custom, apiKey: "" });
		expect(fake.calls.set).toEqual([]);
		expect(fake.calls.remove).toEqual(["my-provider"]);
		expect(fake.calls.dispose).toBe(1);
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
				provider: {
					vllm: {
						npm: "@ai-sdk/openai-compatible",
						name: "vLLM",
						options: { baseURL: "http://127.0.0.1:8000/v1" },
						models: { llama: { name: "Llama" } },
					},
				},
			},
			list: {
				all: [{ id: "vllm", name: "vLLM", source: "config", key: "sk", models: {} }],
				connected: ["vllm"],
			},
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
