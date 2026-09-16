import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/electron/main", () => ({ captureException: vi.fn() }));

import { featureRouter } from "../features/registry/feature-registry.js";
import { registerPreferencesCapability } from "./preferences-capability-bridge.js";
import type { PreferencesStore } from "./PreferencesStore.js";

/**
 * Seam: `registerPreferencesCapability(prefs, env)` exposes a read-only
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
