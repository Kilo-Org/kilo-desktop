import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bundledKiloExecutable, startRealKilo2, type RealKilo2 } from "../../test/real-kilo2";
import { mapAiProviderList } from "./ai-provider-list";
import {
	connectAiProvider,
	disconnectAiProvider,
	readCustomAiProvider,
	saveCustomAiProvider,
} from "./ai-provider-mutations";
import { MASKED_API_KEY } from "./custom-ai-provider";
import type { KiloModelsClient } from "./kilo-models-client";
import { createKiloModelsClient } from "./production";

const kiloExecutable = bundledKiloExecutable();

async function aiProviders(client: KiloModelsClient) {
	const [answers, settings] = await Promise.all([client.listAiProviders(), client.readSettings()]);
	return mapAiProviderList({ answers, settings, contributed: new Set() });
}

describe.skipIf(!kiloExecutable)("AI providers and models on the bundled kilo2", () => {
	let server: RealKilo2;
	let client: KiloModelsClient;

	beforeEach(async () => {
		server = await startRealKilo2(kiloExecutable!);
		client = createKiloModelsClient(server.connection);
	});

	afterEach(async () => {
		await server.stop();
	});

	it("offers Kilo's gateway with its models and the popular AI providers to connect", async () => {
		const state = await aiProviders(client);

		expect(state.aiProviders.kilo).toMatchObject({ connected: true, source: "kilo" });
		expect(state.aiProviders.openai).toMatchObject({ connected: false, env: ["OPENAI_API_KEY"] });
		expect(Object.values(state.models).some((model) => model.aiProviderId === "kilo")).toBe(true);
	});

	it("connects an AI provider with a key, replaces the key, and disconnects it", async () => {
		await connectAiProvider(client, "openai", "sk-first");
		await connectAiProvider(client, "openai", "sk-second");

		const connected = await aiProviders(client);
		expect(connected.aiProviders.openai).toMatchObject({
			connected: true,
			source: "api",
			canDisconnect: true,
		});

		await disconnectAiProvider(client, "openai");
		expect((await aiProviders(client)).aiProviders.openai).toMatchObject({ connected: false });
	});

	it("saves a custom AI provider in v2 config with its key, reads it back and removes it", async () => {
		await saveCustomAiProvider(client, {
			aiProviderId: "mycustom",
			name: "My Custom",
			baseUrl: "http://127.0.0.1:9/v1",
			apiKey: "sk-custom",
			models: [{ modelId: "m1", name: "Model One", contextWindow: 1000, attachments: true }],
		});

		const saved = await aiProviders(client);
		expect(saved.aiProviders.mycustom).toMatchObject({
			name: "My Custom",
			connected: true,
			source: "custom",
		});
		expect(saved.models["mycustom/m1"]).toMatchObject({
			name: "Model One",
			contextWindow: 1000,
			attachments: true,
		});
		await expect(readCustomAiProvider(client, "mycustom")).resolves.toMatchObject({
			baseUrl: "http://127.0.0.1:9/v1",
			apiKey: MASKED_API_KEY,
			models: [{ modelId: "m1", name: "Model One", contextWindow: 1000, attachments: true }],
		});

		await disconnectAiProvider(client, "mycustom");
		const removed = await aiProviders(client);
		expect(removed.aiProviders.mycustom).toBeUndefined();
		expect((await client.readSettings()).providers).not.toHaveProperty("mycustom");
	});

	it("saves the chosen model in the global config", async () => {
		await client.updateSettings({ model: "kilo/kilo-auto/free" });
		await expect(client.readSettings()).resolves.toMatchObject({ model: "kilo/kilo-auto/free" });
	});
});
