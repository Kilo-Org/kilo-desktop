import { mkdirSync } from "node:fs";

import * as Sentry from "@sentry/electron/main";
import { FeatureError, FeatureRouter } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	qualifyFeatureEvent,
	type FeatureEvent,
	type FeatureRegistration,
	type MainSdkFetch,
	type MainSdkHost,
	type MainSdkLogger,
	type MainSdkProtocol,
} from "@anaconda-agentic-desktop/feature-sdk";
import type {
	FeatureEventPayload,
	IpcHandlers,
	IpcMessageHandlers,
	IpcPortHandlers,
} from "@anaconda-agentic-desktop/contracts";

import { BusinessError } from "../../platform/BusinessError.js";
import { createFeatureKvStoreFactory } from "../../platform/featureKvStore.js";
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
	/** Create shell-owned desktop capabilities scoped to a feature id. */
	createHost?: (featureId: string) => MainSdkHost | undefined;
	/**
	 * Create the custom protocol delegate for a feature (manifest-declared schemes).
	 * Called once per feature before its `mainRegister` runs; return
	 * `undefined` to leave the feature without protocol access. Browser mode
	 * and headless environments omit this.
	 */
	createProtocolDelegate?: (featureId: string) => MainSdkProtocol | undefined;
	/**
	 * Base data path (Electron `app.getPath("userData")`). Each feature gets
	 * `${storageRoot}/plugins/<id>` as its `mainSdk.storageDir`, created
	 * lazily on first access (Decision #20). Omit only in environments
	 * without storage.
	 */
	storageRoot?: string;
	/**
	 * Optional callback invoked before each feature's mainRegister runs.
	 * Used by the shell to push per-feature progress to the splash window
	 * without features needing to import any shell internals.
	 */
	onBeforeFeatureBoot?: (featureId: string) => void;
	/**
	 * Receive `mainSdk.boot.reportProgress(msg)` calls a feature makes while
	 * `bootFeatures` is running. After `bootFeatures` returns, subsequent
	 * calls become silent no-ops so async work started during boot cannot
	 * push stale progress into shell UI. Omitting the callback is fine —
	 * features that call the hook still see a no-op, they never crash.
	 *
	 * Distinct from {@link onBeforeFeatureBoot}: the shell fires
	 * `onBeforeFeatureBoot(id)` once before each feature's `mainRegister`
	 * (default "Preparing <id>…" splash line); `onFeatureProgress` is fired
	 * BY the feature from inside `mainRegister` via
	 * `mainSdk.boot.reportProgress(message)` for fine-grained messages like
	 * "Staging Miniconda…".
	 */
	onFeatureProgress?: (featureId: string, message: string) => void;
}

/**
 * Boot all features: call mainRegister(mainSdk) for each entry.
 * Idempotent: features that are already booted are skipped. A mainRegister
 * that throws is rolled back (its partial handlers and disposables removed).
 * Returns a disposer that tears down all features booted by this call —
 * running their onDispose callbacks (DB close, etc.).
 *
 * Supports async mainRegister: if a feature returns a Promise, it is awaited
 * before moving to the next feature. Boot progress delivery remains active
 * throughout the async phase.
 */
export async function bootFeatures(
	features: readonly FeatureRegistration[],
	options?: BootFeaturesOptions,
): Promise<() => Promise<void>> {
	const storageRoot = options?.storageRoot;
	const onFeatureProgress = options?.onFeatureProgress;
	// One flag per bootFeatures call — flipping it after the loop turns every
	// feature's reportProgress into a no-op, even if the feature keeps a
	// reference to the reporter after mainRegister returned.
	let bootWindowOpen = true;
	const booted: string[] = [];
	for (const feature of features) {
		if (bootedFeatureIds.has(feature.id)) {
			console.warn(`[FeatureRegistry] Feature "${feature.id}" is already booted — skipping.`);
			continue;
		}
		options?.onBeforeFeatureBoot?.(feature.id);
		const resolveStorageDir =
			storageRoot === undefined
				? undefined
				: (): string => {
						const dir = featureStorageDir(storageRoot, feature.id);
						mkdirSync(dir, { recursive: true });
						return dir;
					};
		const protocol = options?.createProtocolDelegate?.(feature.id);
		const host = options?.createHost?.(feature.id);
		const mainSdk = featureRouter.createMainSdk(feature.id, {
			...(options?.emitEvent ? { emitEvent: options.emitEvent } : {}),
			...(options?.createLogger ? { logger: options.createLogger(feature.id) } : {}),
			...(options?.fetch ? { fetch: options.fetch } : {}),
			...(host ? { host } : {}),
			...(protocol ? { protocol } : {}),
			...(resolveStorageDir
				? {
						resolveStorageDir,
						createKvStore: (kvOptions) =>
							createFeatureKvStoreFactory(resolveStorageDir())(kvOptions),
					}
				: {}),
			// Plugin registrations from the loader carry a resolveAsset (they know
			// where their package lives on disk); built-in FEATURES don't and
			// mainSdk.resolvePluginAsset would throw for them, which is fine —
			// they ship no assets.
			...(feature.resolveAsset ? { resolvePluginAsset: feature.resolveAsset } : {}),
			// Gate reportProgress on this call's boot window so a feature that
			// captured the reporter cannot push a message after boot has ended.
			...(onFeatureProgress
				? {
						reportBootProgress: (message: string) => {
							if (!bootWindowOpen) return;
							onFeatureProgress(feature.id, message);
						},
					}
				: {}),
		});
		try {
			await feature.mainRegister(mainSdk);
			bootedFeatureIds.add(feature.id);
			booted.push(feature.id);
		} catch (error) {
			console.error(`[FeatureRegistry] mainRegister failed for "${feature.id}":`, error);
			Sentry.captureException(error, { tags: { feature_id: feature.id } });
			// Roll back partial registration so the feature is not half-alive.
			await featureRouter.destroyFeatureAsync(feature.id);
		}
	}
	bootWindowOpen = false;
	return async () => {
		for (const id of booted.reverse()) {
			await featureRouter.destroyFeatureAsync(id);
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
					throw new BusinessError(error.message);
				}
				throw error;
			}
		},
	};
}

/** Route a transferred renderer port to the owning feature's main handler. */
export function createFeaturePortHandlers(): Pick<IpcPortHandlers, "feature:port"> {
	return {
		"feature:port": (input, context) =>
			featureRouter.connectPort(input.featureId, input.channel, context.port, input.args, {
				senderId: context.senderId,
			}),
	};
}
