import { describe, expect, it } from "vitest";

import {
	connectApiKey,
	deleteCustom,
	disconnectProvider,
	saveCustom,
	setDisabled,
	type KiloProviderClient,
} from "./provider-mutations.js";

function createClient(
	existing: {
		disabled_providers?: string[];
		provider?: Record<string, unknown>;
	} = {},
) {
	const calls = {
		set: [] as Array<{ providerID: string; auth: { type: string; key: string } }>,
		remove: [] as Array<{ providerID: string }>,
		update: [] as Array<{ config: Record<string, unknown> }>,
		dispose: 0,
	};
	let global = structuredClone(existing);

	const client: KiloProviderClient = {
		auth: {
			set: async (input) => {
				calls.set.push(input);
				return { data: true };
			},
			remove: async (input) => {
				calls.remove.push(input);
				return { data: true };
			},
		},
		global: {
			dispose: async () => {
				calls.dispose += 1;
			},
			config: {
				get: async () => ({ data: global }),
				update: async (input) => {
					calls.update.push(input);
					global = {
						...global,
						...input.config,
						provider: {
							...(global.provider as Record<string, unknown> | undefined),
							...((input.config.provider as Record<string, unknown> | undefined) ?? {}),
						},
					};
					return { data: global };
				},
			},
		},
	};

	return { client, calls };
}

const customBlock = {
	name: "My Provider",
	options: { baseURL: "https://example.com/v1" },
	models: { "model-1": { name: "Model One" } },
};

describe("connectApiKey", () => {
	it("stores the key then disposes so the catalog reloads", async () => {
		const { client, calls } = createClient();
		await connectApiKey(client, "anthropic", " sk-ant ");
		expect(calls.set).toEqual([{ providerID: "anthropic", auth: { type: "api", key: "sk-ant" } }]);
		expect(calls.dispose).toBe(1);
	});

	it("rejects an invalid provider id", async () => {
		const { client, calls } = createClient();
		await expect(connectApiKey(client, "bad/id", "sk")).rejects.toThrow("Invalid provider ID");
		expect(calls.set).toEqual([]);
		expect(calls.dispose).toBe(0);
	});
});

describe("disconnectProvider", () => {
	it("removes auth and disposes for a catalog provider", async () => {
		const { client, calls } = createClient();
		await disconnectProvider(client, "anthropic");
		expect(calls.remove).toEqual([{ providerID: "anthropic" }]);
		expect(calls.update).toEqual([]);
		expect(calls.dispose).toBe(1);
	});

	it("clears disabled_providers when disconnecting a disabled catalog provider", async () => {
		const { client, calls } = createClient({ disabled_providers: ["openai", "groq"] });
		await disconnectProvider(client, "openai");
		expect(calls.remove).toEqual([{ providerID: "openai" }]);
		expect(calls.update[0]?.config).toEqual({ disabled_providers: ["groq"] });
		expect(calls.dispose).toBe(1);
	});

	it("deletes a custom provider block with a null sentinel", async () => {
		const { client, calls } = createClient({
			disabled_providers: ["vllm"],
			provider: {
				vllm: {
					npm: "@ai-sdk/openai-compatible",
					name: "vLLM",
					options: { baseURL: "http://127.0.0.1:8000/v1" },
				},
			},
		});
		await disconnectProvider(client, "vllm");
		expect(calls.remove).toEqual([{ providerID: "vllm" }]);
		expect(calls.update[0]?.config).toEqual({
			provider: { vllm: null },
			disabled_providers: [],
		});
		expect(calls.dispose).toBe(1);
	});

	it("rethrows auth failures for catalog providers", async () => {
		const { client, calls } = createClient();
		client.auth.remove = async () => {
			throw new Error("nope");
		};
		await expect(disconnectProvider(client, "anthropic")).rejects.toThrow("nope");
		expect(calls.update).toEqual([]);
		expect(calls.dispose).toBe(0);
	});
});

describe("setDisabled", () => {
	it("adds a provider to disabled_providers then disposes", async () => {
		const { client, calls } = createClient({ disabled_providers: [] });
		await setDisabled(client, "openai", true);
		expect(calls.update[0]?.config).toEqual({ disabled_providers: ["openai"] });
		expect(calls.dispose).toBe(1);
	});

	it("removes a provider from disabled_providers then disposes", async () => {
		const { client, calls } = createClient({ disabled_providers: ["openai", "groq"] });
		await setDisabled(client, "openai", false);
		expect(calls.update[0]?.config).toEqual({ disabled_providers: ["groq"] });
		expect(calls.dispose).toBe(1);
	});

	it("does not rewrite config when the disabled list is unchanged", async () => {
		const { client, calls } = createClient({ disabled_providers: ["openai"] });
		await setDisabled(client, "openai", true);
		expect(calls.update).toEqual([]);
		expect(calls.dispose).toBe(1);
	});
});

describe("saveCustom", () => {
	it("writes the sanitized block then the api key, never putting the key in config", async () => {
		const { client, calls } = createClient({ disabled_providers: ["my-provider"] });
		await saveCustom(client, "my-provider", customBlock, " sk-test ", true);
		expect(calls.update[0]?.config).toEqual({
			provider: {
				"my-provider": {
					npm: "@ai-sdk/openai-compatible",
					name: "My Provider",
					options: { baseURL: "https://example.com/v1" },
					models: { "model-1": { name: "Model One" } },
				},
			},
			disabled_providers: [],
		});
		expect(JSON.stringify(calls.update)).not.toContain("sk-test");
		expect(calls.set).toEqual([
			{ providerID: "my-provider", auth: { type: "api", key: "sk-test" } },
		]);
		expect(calls.dispose).toBe(1);
	});

	it("emits null for models removed on edit", async () => {
		const { client, calls } = createClient({
			provider: {
				"my-provider": {
					npm: "@ai-sdk/openai-compatible",
					models: { gone: { name: "Gone" }, "model-1": { name: "Old" } },
				},
			},
		});
		await saveCustom(client, "my-provider", customBlock, undefined, false);
		const first = calls.update[0];
		if (!first) throw new Error("expected a config update");
		const patch = (first.config.provider as Record<string, { models: Record<string, unknown> }>)[
			"my-provider"
		];
		expect(patch.models["model-1"]).toEqual({ name: "Model One" });
		expect(patch.models.gone).toBeNull();
		expect(calls.set).toEqual([]);
		expect(calls.dispose).toBe(1);
	});

	it("clears auth when the api key field is emptied", async () => {
		const { client, calls } = createClient();
		await saveCustom(client, "my-provider", customBlock, "", true);
		expect(calls.set).toEqual([]);
		expect(calls.remove).toEqual([{ providerID: "my-provider" }]);
		expect(calls.dispose).toBe(1);
	});
});

describe("deleteCustom", () => {
	it("nulls the config entry, removes auth, and disposes", async () => {
		const { client, calls } = createClient({
			provider: {
				vllm: { npm: "@ai-sdk/openai-compatible" },
			},
		});
		await deleteCustom(client, "vllm");
		expect(calls.update[0]?.config).toEqual({
			provider: { vllm: null },
			disabled_providers: [],
		});
		expect(calls.remove).toEqual([{ providerID: "vllm" }]);
		expect(calls.dispose).toBe(1);
	});
});
