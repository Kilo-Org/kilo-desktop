import { describe, expect, it } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import { ONBOARDING_VERSION } from "../../contracts/onboarding/schemas.js";

import { OnboardingStore } from "./OnboardingStore.js";

describe("OnboardingStore", () => {
	it("starts open and persists complete and skip", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new OnboardingStore(sdk, {}, () => 42);

		expect(store.get()).toEqual({ outcome: null, closedAt: null, version: null });
		expect(store.complete()).toEqual({
			outcome: "completed",
			closedAt: 42,
			version: ONBOARDING_VERSION,
		});
		expect(store.get()).toEqual({
			outcome: "completed",
			closedAt: 42,
			version: ONBOARDING_VERSION,
		});

		const again = new OnboardingStore(sdk, {}, () => 99);
		expect(again.get()).toEqual({
			outcome: "completed",
			closedAt: 42,
			version: ONBOARDING_VERSION,
		});
		expect(again.skip()).toEqual({ outcome: "skipped", closedAt: 99, version: ONBOARDING_VERSION });
		expect(new OnboardingStore(sdk, {}, () => 7).get()).toEqual({
			outcome: "skipped",
			closedAt: 99,
			version: ONBOARDING_VERSION,
		});
		sdk.dispose();
	});

	it("returns skipped without writing when KILO_SKIP_ONBOARDING is set", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new OnboardingStore(sdk, { KILO_SKIP_ONBOARDING: "1" }, () => 7);

		expect(store.get()).toEqual({ outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION });
		expect(store.complete()).toEqual({
			outcome: "completed",
			closedAt: 7,
			version: ONBOARDING_VERSION,
		});
		expect(new OnboardingStore(sdk, { KILO_SKIP_ONBOARDING: "1" }).get()).toEqual({
			outcome: "skipped",
			closedAt: 1,
			version: ONBOARDING_VERSION,
		});
		sdk.dispose();
	});

	it("reads a record written before versioning as unversioned (v1)", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		sdk.storage
			.kv<Record<string, unknown>>({ namespace: "onboarding", defaults: {} })
			.set({ outcome: "completed", closedAt: 5 });

		expect(new OnboardingStore(sdk).get()).toEqual({
			outcome: "completed",
			closedAt: 5,
			version: null,
		});
		sdk.dispose();
	});
});
