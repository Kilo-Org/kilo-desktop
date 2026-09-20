import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import { ModelPreferenceStore } from "./ModelPreferenceStore.js";

describe("ModelPreferenceStore", () => {
	it("remembers per-agent models and the latest preferred model and effort", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new ModelPreferenceStore(sdk);

		expect(store.get()).toEqual({ modelSelections: {}, variantSelections: {}, recentModels: [] });
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
});
