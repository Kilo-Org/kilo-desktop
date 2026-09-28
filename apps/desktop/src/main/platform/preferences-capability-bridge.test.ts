import { afterEach, describe, expect, it, vi } from "vitest";
import pDefer from "p-defer";
import type { PreferencesMainCapability } from "@kilo-desktop/contracts";

vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));

import { featureRouter } from "../features/registry/feature-registry.js";
import { registerPreferencesCapability } from "./preferences-capability-bridge.js";
import type { PreferencesStore } from "./PreferencesStore.js";

/**
 * Seam: `registerPreferencesCapability(prefs, env)` exposes the shared
 * preferences capability on the real shared `featureRouter`. Tests observe
 * behavior through `capabilityRegistry.get` and always dispose so the
 * singleton stays clean between cases.
 */
function makePreferences(allowDataCollection = true): PreferencesStore {
	return { allowDataCollection } as unknown as PreferencesStore;
}

describe("registerPreferencesCapability", () => {
	let dispose: (() => void) | undefined;

	afterEach(() => {
		dispose?.();
		dispose = undefined;
	});

	it("exposes the allowDataCollection preference", () => {
		dispose = registerPreferencesCapability(makePreferences(true), "production");

		const capability = featureRouter.capabilityRegistry.get("preferences") as {
			preferences: { allowDataCollection: boolean; telemetryEnv: string };
		} | null;

		expect(capability).not.toBeNull();
		expect(capability!.preferences.allowDataCollection).toBe(true);
	});

	it("delegates awaited writes and change subscriptions to the authoritative store", async () => {
		const listener = vi.fn();
		const unsubscribe = vi.fn();
		const pending = pDefer<void>();
		const prefs = {
			allowDataCollection: false,
			setAllowDataCollection: vi.fn(() => pending.promise),
			onDidChangeAllowDataCollection: vi.fn(() => unsubscribe),
		} as unknown as PreferencesStore;
		dispose = registerPreferencesCapability(prefs, "production");
		const { preferences } = featureRouter.capabilityRegistry.get(
			"preferences",
		) as PreferencesMainCapability;
		expect(preferences.onDidChangeAllowDataCollection(listener)).toBe(unsubscribe);
		expect(prefs.onDidChangeAllowDataCollection).toHaveBeenCalledWith(listener);
		const write = preferences.setAllowDataCollection(true);
		expect(write).toBe(pending.promise);
		expect(prefs.setAllowDataCollection).toHaveBeenCalledWith(true);
		pending.resolve();
		await write;
	});

	it("exposes the telemetryEnv value", () => {
		dispose = registerPreferencesCapability(makePreferences(), "development");

		const capability = featureRouter.capabilityRegistry.get("preferences") as {
			preferences: { allowDataCollection: boolean; telemetryEnv: string };
		} | null;

		expect(capability!.preferences.telemetryEnv).toBe("development");
	});

	it("reads allowDataCollection live from the store", () => {
		const prefs = { allowDataCollection: true } as unknown as PreferencesStore;
		dispose = registerPreferencesCapability(prefs, "production");

		const capability = featureRouter.capabilityRegistry.get("preferences") as {
			preferences: { allowDataCollection: boolean };
		};

		expect(capability.preferences.allowDataCollection).toBe(true);

		// Simulate the user toggling the preference
		(prefs as { allowDataCollection: boolean }).allowDataCollection = false;
		expect(capability.preferences.allowDataCollection).toBe(false);
	});

	it("removes the capability when disposed", () => {
		const disposer = registerPreferencesCapability(makePreferences(), "production");

		disposer();

		expect(featureRouter.capabilityRegistry.get("preferences")).toBeNull();
	});
});
