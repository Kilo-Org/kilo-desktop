import { featureRouter } from "../registry/feature-registry.js";

import type { AnacondaCredentialStore } from "./anaconda-credential-store.js";
import type { AuthSessionService } from "./auth-service.js";

/**
 * Expose the main-side `auth` capability: the Anaconda credential (API key and
 * site) and the Kilo-backed app session. Features/plugins read the key via:
 *
 * ```ts
 * const auth = mainSdk.plugins.get<AuthMainCapability>("auth");
 * const apiKey = await auth?.session.getApiKey();
 * const domain = await auth?.session.getSiteDomain();
 * ```
 *
 * Also relays app session changes to the feature event bus (`auth.changed`) so
 * main-side features can subscribe via `mainSdk.events.on("auth.changed", ...)`.
 *
 * Returns a disposer that cleans up the capability registration and event
 * subscription.
 */
export function registerAuthCapability(
	session: Pick<AuthSessionService, "getSession" | "onChanged">,
	anaconda: Pick<
		AnacondaCredentialStore,
		"getApiKey" | "saveApiKey" | "deleteApiKey" | "getSiteDomain" | "getOAuthSettings"
	>,
): () => void {
	// Expose the auth capability under the "auth" feature ID. The capability
	// name "session" becomes the property name in the merged result —
	// consumers read `auth.session.getApiKey()` / `auth.session.getSiteDomain()`.
	featureRouter.capabilityRegistry.expose("auth", "session", {
		getApiKey: () => anaconda.getApiKey(),
		saveApiKey: (apiKey: string) => anaconda.saveApiKey(apiKey),
		deleteApiKey: () => anaconda.deleteApiKey(),
		getSiteDomain: () => anaconda.getSiteDomain(),
		getOAuthSettings: () => anaconda.getOAuthSettings(),
		getSession: () => session.getSession(),
	});

	// Relay auth session changes to the feature event bus so main-side
	// features can subscribe via mainSdk.events.on("auth.changed", handler).
	const unsubscribe = session.onChanged((next) => {
		featureRouter.eventBus.emit("auth.changed", next);
	});

	return () => {
		featureRouter.capabilityRegistry.removeFeature("auth");
		unsubscribe();
	};
}
