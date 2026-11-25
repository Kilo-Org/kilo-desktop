import { afterEach, describe, expect, it } from "vitest";

import { kilo2Executable, startKilo2, type Kilo2 } from "../../test/agent/kilo2-harness.js";
import { readCustomAiProvider, saveCustomAiProvider } from "./ai-provider-mutations.js";
import { mapAiProviderList } from "./ai-provider-list.js";
import { createKiloModelsClient } from "./kilo-models-client.js";

describe.skipIf(!kilo2Executable)("AI providers and models in the bundled kilo2", () => {
	let kilo: Kilo2 | undefined;

	afterEach(async () => {
		await kilo?.stop();
		kilo = undefined;
	});

	it("saves a custom AI provider with a key, lists its models, and reads it back", async () => {
		kilo = await startKilo2();
		const client = createKiloModelsClient(kilo.connection);

		await saveCustomAiProvider(client, {
			aiProviderId: "local-vllm",
			name: "Local vLLM",
			baseUrl: "http://127.0.0.1:9/v1",
			apiKey: "sk-local",
			models: [{ modelId: "llama", name: "Llama", attachments: true, contextWindow: 32_000 }],
		});

		const { aiProviders, models } = mapAiProviderList({
			catalog: await client.readCatalog(),
			config: await client.readGlobalConfig(),
			contributed: new Set(),
		});
		expect(aiProviders["local-vllm"]).toMatchObject({
			name: "Local vLLM",
			connected: true,
			source: "custom",
		});
		expect(models["local-vllm/llama"]).toMatchObject({
			name: "Llama",
			attachments: true,
			contextWindow: 32_000,
		});
		await expect(readCustomAiProvider(client, "local-vllm")).resolves.toMatchObject({
			name: "Local vLLM",
			apiKey: expect.any(String),
		});
	});

	it("connects and disconnects an AI provider with a key", async () => {
		kilo = await startKilo2();
		const client = createKiloModelsClient(kilo.connection);
		const anthropic = async () =>
			mapAiProviderList({
				catalog: await client.readCatalog(),
				config: {},
				contributed: new Set(),
			}).aiProviders.anthropic;

		await client.setApiKey("anthropic", "sk-ant-test");
		await client.reload();
		await expect(anthropic()).resolves.toMatchObject({ connected: true, source: "api" });

		await client.removeApiKey("anthropic");
		await client.reload();
		await expect(anthropic()).resolves.toMatchObject({ connected: false });
	});
});
