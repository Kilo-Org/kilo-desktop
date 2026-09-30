import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import { ModelPreferenceStore } from "./ModelPreferenceStore.js";

describe("ModelPreferenceStore", () => {
	it("remembers per-agent models and the latest preferred model and effort", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new ModelPreferenceStore(sdk);

		expect(store.get()).toEqual({
			modelSelections: {},
			variantSelections: {},
			recentModels: [],
			autoFreeModelsEnabled: true,
		});
		store.remember({
			agent: "code",
			model: { providerID: "kilo", modelID: "kilo-auto/free" },
			effort: "high",
		});
		const saved = store.remember({
			agent: "ask",
			model: { providerID: "openai", modelID: "gpt-5.6-sol" },
		});

		expect(saved).toEqual({
			modelSelections: {
				code: { providerID: "kilo", modelID: "kilo-auto/free" },
				ask: { providerID: "openai", modelID: "gpt-5.6-sol" },
			},
			preferred: { providerID: "openai", modelID: "gpt-5.6-sol", variant: "" },
			variantSelections: {
				"code/kilo/kilo-auto/free": "high",
				"ask/openai/gpt-5.6-sol": "",
			},
			recentModels: [
				{ providerID: "openai", modelID: "gpt-5.6-sol" },
				{ providerID: "kilo", modelID: "kilo-auto/free" },
			],
			autoFreeModelsEnabled: true,
		});
		expect(new ModelPreferenceStore(sdk).get()).toEqual(saved);
		expect(
			store.recordRecent({ providerID: "kilo", modelID: "kilo-auto/free" }).recentModels,
		).toEqual([
			{ providerID: "kilo", modelID: "kilo-auto/free" },
			{ providerID: "openai", modelID: "gpt-5.6-sol" },
		]);
		sdk.dispose();
	});

	it("persists the free-models opt-out and survives store re-instantiation", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new ModelPreferenceStore(sdk);

		const disabled = store.setAutoFreeEnabled(false);
		expect(disabled.autoFreeModelsEnabled).toBe(false);
		expect(new ModelPreferenceStore(sdk).get().autoFreeModelsEnabled).toBe(false);

		expect(store.setAutoFreeEnabled(true).autoFreeModelsEnabled).toBe(true);
		sdk.dispose();
	});
});
