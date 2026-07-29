import { FeatureRouter } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";
import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

/**
 * Central feature router for the main process.
 * Populated by mainRegister() calls from each feature in the FEATURES array.
 */
export const featureRouter = new FeatureRouter();

/**
 * Boot all features: call mainRegister(mainSdk) for each entry.
 */
export function bootFeatures(features: readonly FeatureRegistration[]): void {
	for (const feature of features) {
		const mainSdk = featureRouter.createMainSdk(feature.id);
		try {
			feature.mainRegister(mainSdk);
		} catch (error) {
			console.error(`[FeatureRegistry] mainRegister failed for "${feature.id}":`, error);
		}
	}
}

/**
 * IPC handlers for the feature system.
 * Routes { featureId, channel, args } to the correct handler in the router.
 */
export function createFeatureHandlers(): Pick<IpcHandlers, "feature:invoke"> {
	return {
		"feature:invoke": (input) => featureRouter.invoke(input.featureId, input.channel, input.args),
	};
}
