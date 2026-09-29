import { featureRouter } from "../features/registry/feature-registry.js";

import type { PreferencesStore } from "./PreferencesStore.js";

/**
 * Expose the user's data-collection preference and the telemetry environment
 * attribute as a main-side plugin capability so plugins can gate their own
 * telemetry:
 *
 * ```ts
 * const prefs = mainSdk.plugins.get<PreferencesMainCapability>("preferences");
 * const allowed = prefs?.preferences.allowDataCollection ?? false;
 * ```
 *
 * Returns a disposer that removes the capability.
 */
export function registerPreferencesCapability(
	preferences: PreferencesStore,
	telemetryEnv: string,
): () => void {
	featureRouter.capabilityRegistry.expose("preferences", "preferences", {
		get allowDataCollection() {
			return preferences.allowDataCollection;
		},
		get installationId() {
			return preferences.getInstallationId();
		},
		telemetryEnv,
		setAllowDataCollection: (allow: boolean) => preferences.setAllowDataCollection(allow),
		onDidChangeAllowDataCollection: (listener: (allow: boolean) => void | Promise<void>) =>
			preferences.onDidChangeAllowDataCollection(listener),
	});

	return () => {
		featureRouter.capabilityRegistry.removeFeature("preferences");
	};
}
