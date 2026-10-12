import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import { KILO_TERMS_VERSION } from "../../contracts/onboarding/schemas.js";

import { createInMemoryTermsStorage, TermsAcceptanceStore } from "./TermsAcceptanceStore.js";

describe("TermsAcceptanceStore", () => {
	it("has no record until the terms are accepted, then persists it", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, { now: () => 42 });

		expect(store.get()).toBeNull();
		expect(store.accept("v1")).toEqual({ version: "v1", acceptedAt: 42, linkedAccounts: [] });
		expect(new TermsAcceptanceStore(sdk, { now: () => 99 }).get()).toEqual({
			version: "v1",
			acceptedAt: 42,
			linkedAccounts: [],
		});
		sdk.dispose();
	});

	it("keeps the first acceptance time when the same version is accepted again", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		new TermsAcceptanceStore(sdk, { now: () => 1 }).accept("v1");

		expect(new TermsAcceptanceStore(sdk, { now: () => 2 }).accept("v1", "acct-a")).toEqual({
			version: "v1",
			acceptedAt: 1,
			linkedAccounts: ["acct-a"],
		});
		sdk.dispose();
	});

	it("starts a fresh, unlinked record when a new version is accepted", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, { now: () => 1 });
		store.accept("v1", "acct-a");

		expect(new TermsAcceptanceStore(sdk, { now: () => 5 }).accept("v2")).toEqual({
			version: "v2",
			acceptedAt: 5,
			linkedAccounts: [],
		});
		sdk.dispose();
	});

	it("works on injected in-memory storage without touching the SDK's KV", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const kv = vi.spyOn(sdk.storage, "kv");
		const store = new TermsAcceptanceStore(sdk, {
			now: () => 3,
			storage: createInMemoryTermsStorage(),
		});

		expect(store.get()).toBeNull();
		store.accept("v1", "acct");
		expect(store.get()).toEqual({ version: "v1", acceptedAt: 3, linkedAccounts: ["acct"] });
		expect(kv).not.toHaveBeenCalled();
		sdk.dispose();
	});

	it("reports the current terms as accepted without writing when KILO_SKIP_ONBOARDING is set", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, { env: { KILO_SKIP_ONBOARDING: "1" } });

		expect(store.get()).toEqual({ version: KILO_TERMS_VERSION, acceptedAt: 1, linkedAccounts: [] });
		expect(store.markLinked("acct-a")?.linkedAccounts).toEqual(["acct-a"]);
		expect(new TermsAcceptanceStore(sdk).get()).toBeNull();
		sdk.dispose();
	});

	it("links each account once and ignores links before any acceptance", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, { now: () => 1 });

		expect(store.markLinked("acct-a")).toBeNull();
		store.accept("v1");
		store.markLinked("acct-a");
		store.markLinked("acct-b");

		expect(store.markLinked("acct-a")?.linkedAccounts).toEqual(["acct-a", "acct-b"]);
		expect(new TermsAcceptanceStore(sdk).get()?.linkedAccounts).toEqual(["acct-a", "acct-b"]);
		sdk.dispose();
	});
});
