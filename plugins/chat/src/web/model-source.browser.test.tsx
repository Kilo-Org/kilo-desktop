import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry } from "@kilo-desktop/kernel";
import { modelKey, type ModelInfo, type ModelsState } from "@kilo-desktop/plugin-core/contracts";

import { ModelSource, type ModelSourceImplementation, type ModelSourceState } from "../contracts";
import { TEST_MODELS } from "../test/fake-core";
import { renderChat as renderAgentPane } from "../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const LOCAL = "kilo-desktop-model-server";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function localSource(implementation: ModelSourceImplementation) {
	const web: PluginEntry = {
		activate(sdk) {
			sdk.extensions.implement(ModelSource, "local", implementation);
		},
	};
	return {
		manifest: {
			manifestVersion: 1,
			id: "acme.local",
			displayName: "Acme local",
			version: "1.0.0",
			requires: { "kilo.chat/model-source": "optional" },
			contributes: {
				extensions: {
					"kilo.chat/model-source": [
						{
							id: "local",
							aiProviderId: LOCAL,
							title: "Local Model Server",
							settingsSection: "local-model-server",
						},
					],
				},
			},
		},
		web,
	};
}

const state = (patch: Partial<ModelSourceState> = {}): ModelSourceState => ({
	status: { status: "idle" },
	modelIds: [],
	pending: false,
	...patch,
});

const qwen: ModelInfo = {
	aiProviderId: LOCAL,
	modelId: "qwen",
	name: "Qwen",
	variants: [],
	attachments: true,
	reasoning: false,
	free: false,
	byok: false,
};

/** kilo.core's models with the local provider serving Qwen, its default. */
const modelsWithLocalModel: ModelsState = {
	...TEST_MODELS,
	aiProviders: {
		[LOCAL]: {
			id: LOCAL,
			name: "Local",
			connected: true,
			source: "config",
			env: [],
			canDisconnect: false,
		},
	},
	models: { [modelKey(qwen)]: qwen },
	defaults: { [LOCAL]: "qwen" },
};

async function send(text: string) {
	await userEvent.fill(page.getByTestId("kilo-composer-input"), text);
	await page.getByTestId("kilo-composer-send").click();
}

describe("the model-source point", () => {
	it("loads the prompt's model before sending it", async () => {
		const loading = deferred();
		const prepare = vi.fn(() => loading.promise);
		const host = await renderAgentPane({
			models: modelsWithLocalModel,
			plugins: [localSource({ useState: () => state({ modelIds: ["qwen"] }), prepare })],
		});

		await page.getByTestId("kilo-model-selector-trigger").click();
		await page.getByRole("option", { name: /Qwen/ }).click();
		await send("Hello local");

		await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith("qwen"), { timeout: 10_000 });
		expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toHaveLength(0);
		loading.resolve();
		await vi.waitFor(
			() =>
				expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toHaveLength(1),
			{ timeout: 10_000 },
		);
	});

	it("sends prompts for other providers without loading anything", async () => {
		const prepare = vi.fn(async () => undefined);
		const host = await renderAgentPane({
			plugins: [localSource({ useState: () => state(), prepare })],
		});

		await page.getByTestId("kilo-model-selector-trigger").click();
		await page.getByRole("option", { name: /Deep Two/ }).click();
		await send("Hello acme");

		await vi.waitFor(
			() =>
				expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toHaveLength(1),
			{ timeout: 10_000 },
		);
		const [prompt] = host.server.requestsTo("POST", "/session/ses_new_1/prompt_async");
		expect((prompt!.body as { model: unknown }).model).toEqual({
			providerID: "acme",
			modelID: "deep-2",
		});
		expect(prepare).not.toHaveBeenCalled();
	});

	it("adds the source's rail to the picker and starts it when chosen", async () => {
		const start = vi.fn(async () => undefined);
		await renderAgentPane({
			plugins: [localSource({ useState: () => state(), start })],
		});

		await page.getByTestId("kilo-model-selector-trigger").click();
		const rail = page.getByTestId(`kilo-model-selector-rail-${LOCAL}`);
		await expect.element(rail, { timeout: 10_000 }).toBeEnabled();
		await rail.click();

		await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), { timeout: 10_000 });
		await expect
			.element(page.getByRole("button", { name: "Add a local model" }), { timeout: 10_000 })
			.toBeVisible();
	});
});
