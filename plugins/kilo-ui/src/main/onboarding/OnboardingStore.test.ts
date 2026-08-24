import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { OnboardingStore } from "./OnboardingStore.js";

describe("OnboardingStore", () => {
	it("starts open and persists complete and skip", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new OnboardingStore(sdk, {}, () => 42);

		expect(store.get()).toEqual({ outcome: null, closedAt: null });
		expect(store.complete()).toEqual({ outcome: "completed", closedAt: 42 });
		expect(store.get()).toEqual({ outcome: "completed", closedAt: 42 });

		const again = new OnboardingStore(sdk, {}, () => 99);
		expect(again.get()).toEqual({ outcome: "completed", closedAt: 42 });
		expect(again.skip()).toEqual({ outcome: "skipped", closedAt: 99 });
		expect(new OnboardingStore(sdk, {}, () => 7).get()).toEqual({
			outcome: "skipped",
			closedAt: 99,
		});
		sdk.dispose();
	});

	it("returns skipped without writing when ANACONDA_SKIP_ONBOARDING is set", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new OnboardingStore(sdk, { ANACONDA_SKIP_ONBOARDING: "1" }, () => 7);

		expect(store.get()).toEqual({ outcome: "skipped", closedAt: 1 });
		expect(store.complete()).toEqual({ outcome: "completed", closedAt: 7 });
		expect(new OnboardingStore(sdk, { ANACONDA_SKIP_ONBOARDING: "1" }).get()).toEqual({
			outcome: "skipped",
			closedAt: 1,
		});
		sdk.dispose();
	});
});
