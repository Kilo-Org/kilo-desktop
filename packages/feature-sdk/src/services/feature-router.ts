import type { MainSdk } from "../types/sdk.js";

type Handler = (args: unknown) => unknown | Promise<unknown>;

/**
 * In-memory handler router.
 * Stores handlers registered by features via mainSdk.handle().
 * In Electron mode: the main process populates this, called via IPC.
 * In browser mode: the renderer populates and calls this directly.
 */
export class FeatureRouter {
	private handlers = new Map<string, Map<string, Handler>>();
	private disposables = new Map<string, Array<() => void>>();

	/**
	 * Create a MainSdk instance scoped to a specific feature.
	 * The feature uses this to register its handlers.
	 */
	createMainSdk(featureId: string): MainSdk {
		if (!this.handlers.has(featureId)) {
			this.handlers.set(featureId, new Map());
		}
		if (!this.disposables.has(featureId)) {
			this.disposables.set(featureId, []);
		}

		return {
			featureId,
			handle: (channel: string, handler: Handler) => {
				this.handlers.get(featureId)!.set(channel, handler);
			},
			onDispose: (fn: () => void) => {
				this.disposables.get(featureId)!.push(fn);
			},
		};
	}

	/**
	 * Invoke a handler. Used by the SDK's sdk.invoke() and by the IPC bridge.
	 */
	async invoke(featureId: string, channel: string, args?: unknown): Promise<unknown> {
		const featureHandlers = this.handlers.get(featureId);
		if (!featureHandlers) {
			throw new Error(`No handlers registered for feature: ${featureId}`);
		}
		const handler = featureHandlers.get(channel);
		if (!handler) {
			throw new Error(`No handler for channel "${channel}" in feature "${featureId}"`);
		}
		return handler(args);
	}

	/**
	 * Check if a feature has a handler for a channel.
	 */
	has(featureId: string, channel: string): boolean {
		return this.handlers.get(featureId)?.has(channel) ?? false;
	}

	/**
	 * Destroy a feature: run its disposables and remove all handlers.
	 */
	destroyFeature(featureId: string): void {
		const disposables = this.disposables.get(featureId);
		if (disposables) {
			for (const fn of disposables.reverse()) {
				try {
					fn();
				} catch (error) {
					console.warn(`[FeatureRouter] Dispose callback for "${featureId}" threw:`, error);
				}
			}
		}
		this.handlers.delete(featureId);
		this.disposables.delete(featureId);
	}
}
