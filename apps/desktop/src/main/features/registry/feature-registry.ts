import { FeatureError, FeatureRouter } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";
import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import { BusinessError } from "../../platform/BusinessError.js";

/**
 * Central feature router for the main process.
 * Populated by mainRegister() calls from each feature in the FEATURES array.
 */
export const featureRouter = new FeatureRouter();

const bootedFeatureIds = new Set<string>();

/**
 * Boot all features: call mainRegister(mainSdk) for each entry.
 * Idempotent: features that are already booted are skipped. A mainRegister
 * that throws is rolled back (its partial handlers and disposables removed).
 * Returns a disposer that tears down all features booted by this call —
 * running their onDispose callbacks (DB close, etc.).
 */
export function bootFeatures(features: readonly FeatureRegistration[]): () => void {
	const booted: string[] = [];
	for (const feature of features) {
		if (bootedFeatureIds.has(feature.id)) {
			console.warn(`[FeatureRegistry] Feature "${feature.id}" is already booted — skipping.`);
			continue;
		}
		const mainSdk = featureRouter.createMainSdk(feature.id);
		try {
			feature.mainRegister(mainSdk);
			bootedFeatureIds.add(feature.id);
			booted.push(feature.id);
		} catch (error) {
			console.error(`[FeatureRegistry] mainRegister failed for "${feature.id}":`, error);
			// Roll back partial registration so the feature is not half-alive.
			featureRouter.destroyFeature(feature.id);
		}
	}
	return () => {
		for (const id of booted.reverse()) {
			featureRouter.destroyFeature(id);
			bootedFeatureIds.delete(id);
		}
	};
}

/**
 * IPC handlers for the feature system.
 * Routes { featureId, channel, args } to the correct handler in the router.
 * FeatureError is translated to BusinessError so its message survives the
 * IpcServer error envelope instead of being scrubbed to a generic string.
 */
export function createFeatureHandlers(): Pick<IpcHandlers, "feature:invoke"> {
	return {
		"feature:invoke": async (input) => {
			try {
				return await featureRouter.invoke(input.featureId, input.channel, input.args);
			} catch (error) {
				if (error instanceof FeatureError) {
					throw new BusinessError(`[${error.code}] ${error.message}`);
				}
				throw error;
			}
		},
	};
}
