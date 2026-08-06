import { mkdirSync } from "node:fs";

import { FeatureError, FeatureRouter } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	qualifyFeatureEvent,
	type FeatureEvent,
	type FeatureRegistration,
	type MainSdkFetch,
	type MainSdkLogger,
} from "@anaconda-agentic-desktop/feature-sdk";
import type {
	FeatureEventPayload,
	IpcHandlers,
	IpcMessageHandlers,
} from "@anaconda-agentic-desktop/contracts";

import { BusinessError } from "../../platform/BusinessError.js";
import { featureStorageDir } from "../../platform/featureStorage.js";

/**
 * Central feature router for the main process.
 * Populated by mainRegister() calls from each feature in the FEATURES array.
 */
export const featureRouter = new FeatureRouter();

const bootedFeatureIds = new Set<string>();

export interface BootFeaturesOptions {
	/** Relay main-emitted events to every renderer window. */
	emitEvent?: (event: FeatureEvent) => void;
	/** Create the host logger scoped to a feature id. */
	createLogger?: (featureId: string) => MainSdkLogger;
	/** Host networking implementation shared by main-process features. */
	fetch?: MainSdkFetch;
	/**
	 * Base data path (Electron `app.getPath("userData")`). Each feature gets
	 * `${storageRoot}/plugins/<id>` as its `mainSdk.storageDir`, created
	 * lazily on first access (Decision #20). Omit only in environments
	 * without storage.
	 */
	storageRoot?: string;
}

/**
 * Boot all features: call mainRegister(mainSdk) for each entry.
 * Idempotent: features that are already booted are skipped. A mainRegister
 * that throws is rolled back (its partial handlers and disposables removed).
 * Returns a disposer that tears down all features booted by this call —
 * running their onDispose callbacks (DB close, etc.).
 */
export function bootFeatures(
	features: readonly FeatureRegistration[],
	options?: BootFeaturesOptions,
): () => void {
	const storageRoot = options?.storageRoot;
	const booted: string[] = [];
	for (const feature of features) {
		if (bootedFeatureIds.has(feature.id)) {
			console.warn(`[FeatureRegistry] Feature "${feature.id}" is already booted — skipping.`);
			continue;
		}
		const mainSdk = featureRouter.createMainSdk(feature.id, {
			...(options?.emitEvent ? { emitEvent: options.emitEvent } : {}),
			...(options?.createLogger ? { logger: options.createLogger(feature.id) } : {}),
			...(options?.fetch ? { fetch: options.fetch } : {}),
			...(storageRoot === undefined
				? {}
				: {
						resolveStorageDir: () => {
							const dir = featureStorageDir(storageRoot, feature.id);
							mkdirSync(dir, { recursive: true });
							return dir;
						},
					}),
			// Plugin registrations from the loader carry a resolveAsset (they know
			// where their package lives on disk); built-in FEATURES don't and
			// mainSdk.resolvePluginAsset would throw for them, which is fine —
			// they ship no assets.
			...(feature.resolveAsset ? { resolvePluginAsset: feature.resolveAsset } : {}),
		});
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
 * Renderer-to-main event delivery. The origin renderer already received the
 * event in-process, so the relay excludes it while forwarding to other
 * windows. Delivering directly to the router's event bus prevents an echo through
 * MainSdk's outbound relay.
 */
export function createFeatureMessageHandlers(
	relayToRenderers?: (event: FeatureEventPayload, senderId: number) => void,
): Pick<IpcMessageHandlers, "feature:event"> {
	return {
		"feature:event": (event, context) => {
			const relayEvent = structuredClone(event);
			featureRouter.eventBus.emit(qualifyFeatureEvent(event.featureId, event.name), event.payload);
			relayToRenderers?.(relayEvent, context.senderId);
		},
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
