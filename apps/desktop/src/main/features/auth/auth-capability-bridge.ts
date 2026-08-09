import { featureRouter } from "../registry/feature-registry.js";

import type { AuthSessionService } from "./auth-service.js";

/**
 * Expose the auth shell delegate as a main-side plugin capability so
 * features/plugins can access the API key via:
 *
 * ```ts
 * const auth = mainSdk.plugins.get<AuthMainCapability>("auth");
 * const apiKey = await auth?.auth.getApiKey();
 * ```
 *
 * Also relays session changes to the feature event bus (`auth.changed`) so
 * main-side features can subscribe via `mainSdk.events.on("auth.changed", ...)`.
 *
 * Returns a disposer that cleans up the capability registration and event
 * subscription.
 */
export function registerAuthCapability(auth: AuthSessionService): () => void {
	// Expose the auth capability under the "auth" feature ID.
	// The capability name "auth" becomes the property name in the merged result.
	featureRouter.capabilityRegistry.expose("auth", "auth", {
		getApiKey: () => auth.getApiKey(),
	});

	// Relay auth session changes to the feature event bus so main-side
	// features can subscribe via mainSdk.events.on("auth.changed", handler).
	const unsubscribe = auth.onChanged((session) => {
		featureRouter.eventBus.emit("auth.changed", session);
	});

	return () => {
		featureRouter.capabilityRegistry.removeFeature("auth");
		unsubscribe();
	};
}
