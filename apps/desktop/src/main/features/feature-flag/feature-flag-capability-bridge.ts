import { featureRouter } from "../registry/feature-registry.js";

import type { FeatureFlagService } from "./service.js";

/**
 * Expose the feature-flag service as a main-side plugin capability so
 * features/plugins can gate their behavior on a flag via:
 *
 * ```ts
 * const ff = mainSdk.plugins.get<FeatureFlagMainCapability>("feature-flag");
 * const enabled = ff?.featureFlag.getFlag("remote-anaconda-mcp", false) ?? false;
 * ```
 *
 * Also relays flag-change events to the feature event bus so main-side
 * features can re-run their reconcile on a toggle:
 *
 * ```ts
 * mainSdk.events.on("feature-flag.changed", () => service.reconcile());
 * ```
 *
 * Returns a disposer that removes the capability and unsubscribes.
 */
export function registerFeatureFlagCapability(service: FeatureFlagService): () => void {
	featureRouter.capabilityRegistry.expose("feature-flag", "featureFlag", {
		getFlag: <T>(key: string, defaultValue: T) => service.getFlag<T>(key, defaultValue),
	});

	const onChange = (flags: Record<string, unknown>): void => {
		featureRouter.eventBus.emit("feature-flag.changed", flags);
	};
	service.on("change", onChange);

	return () => {
		service.off("change", onChange);
		featureRouter.capabilityRegistry.removeFeature("feature-flag");
	};
}
