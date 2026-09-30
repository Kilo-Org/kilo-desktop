import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@kilo-desktop/testing";

import { createInMemoryTermsStorage, TermsAcceptanceStore } from "./TermsAcceptanceStore.js";

describe("TermsAcceptanceStore", () => {
	it("has no record until the terms are accepted, then persists it", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, () => 42);

		expect(store.get()).toBeNull();
		expect(store.accept("v1")).toEqual({ version: "v1", acceptedAt: 42, linkedAccounts: [] });
		expect(new TermsAcceptanceStore(sdk, () => 99).get()).toEqual({
			version: "v1",
			acceptedAt: 42,
			linkedAccounts: [],
		});
		sdk.dispose();
	});

	it("keeps the first acceptance time when the same version is accepted again", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		new TermsAcceptanceStore(sdk, () => 1).accept("v1");

		expect(new TermsAcceptanceStore(sdk, () => 2).accept("v1", "acct-a")).toEqual({
			version: "v1",
			acceptedAt: 1,
			linkedAccounts: ["acct-a"],
		});
		sdk.dispose();
	});

	it("starts a fresh, unlinked record when a new version is accepted", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, () => 1);
		store.accept("v1", "acct-a");

		expect(new TermsAcceptanceStore(sdk, () => 5).accept("v2")).toEqual({
			version: "v2",
			acceptedAt: 5,
			linkedAccounts: [],
		});
		sdk.dispose();
	});

	it("works on injected in-memory storage without touching the SDK's KV", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const kv = vi.spyOn(sdk.storage, "kv");
		const store = new TermsAcceptanceStore(sdk, () => 3, createInMemoryTermsStorage());

		expect(store.get()).toBeNull();
		store.accept("v1", "acct");
		expect(store.get()).toEqual({ version: "v1", acceptedAt: 3, linkedAccounts: ["acct"] });
		expect(kv).not.toHaveBeenCalled();
		sdk.dispose();
	});

	it("links each account once and ignores links before any acceptance", () => {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const store = new TermsAcceptanceStore(sdk, () => 1);

		expect(store.markLinked("acct-a")).toBeNull();
		store.accept("v1");
		store.markLinked("acct-a");
		store.markLinked("acct-b");

		expect(store.markLinked("acct-a")?.linkedAccounts).toEqual(["acct-a", "acct-b"]);
		expect(new TermsAcceptanceStore(sdk).get()?.linkedAccounts).toEqual(["acct-a", "acct-b"]);
		sdk.dispose();
	});
});
