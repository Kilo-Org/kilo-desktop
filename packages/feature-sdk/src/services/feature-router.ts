import { FeatureError } from "../errors.js";

import type { MainSdk, SchemaLike } from "../types/sdk.js";

type Handler = (args: never) => unknown | Promise<unknown>;

interface HandlerEntry {
	inputSchema: SchemaLike | null;
	handler: Handler;
}

/**
 * Fallback transport used when no local handler exists for a channel.
 * In the renderer (Electron mode) this routes through the feature:invoke IPC channel.
 */
export type InvokeFallback = (
	featureId: string,
	channel: string,
	args?: unknown,
) => Promise<unknown>;

export interface FeatureRouterOptions {
	fallback?: InvokeFallback;
}

/**
 * In-memory handler router.
 * Stores handlers registered by features via mainSdk.handle().
 * In Electron main: features populate this; the IPC bridge calls invoke().
 * In the renderer: local handlers win (browser mode); otherwise the fallback
 * transport is used (Electron mode → IPC).
 */
export class FeatureRouter {
	private handlers = new Map<string, Map<string, HandlerEntry>>();
	private disposables = new Map<string, Array<() => void>>();
	private readonly fallback: InvokeFallback | undefined;

	constructor(options?: FeatureRouterOptions) {
		this.fallback = options?.fallback;
	}

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
			handle: <T>(
				channel: string,
				inputSchema: SchemaLike<T> | null,
				handler: (args: T) => unknown | Promise<unknown>,
			) => {
				const channels = this.handlers.get(featureId)!;
				if (channels.has(channel)) {
					console.warn(
						`[FeatureRouter] Handler for "${featureId}:${channel}" registered twice — replacing.`,
					);
				}
				channels.set(channel, { inputSchema, handler });
			},
			onDispose: (fn: () => void) => {
				this.disposables.get(featureId)!.push(fn);
			},
		};
	}

	/**
	 * Invoke a handler. Used by the SDK's sdk.invoke() and by the IPC bridge.
	 * Validates args against the handler's input schema before invoking.
	 * Unknown feature/channel falls back to the injected transport when present.
	 */
	async invoke(featureId: string, channel: string, args?: unknown): Promise<unknown> {
		const entry = this.handlers.get(featureId)?.get(channel);
		if (!entry) {
			if (this.fallback) {
				return this.fallback(featureId, channel, args);
			}
			throw new FeatureError(
				`No handler for channel "${channel}" in feature "${featureId}".`,
				"NOT_FOUND",
			);
		}

		let parsedArgs: unknown = args;
		if (entry.inputSchema) {
			try {
				parsedArgs = entry.inputSchema.parse(args);
			} catch (error) {
				throw new FeatureError(
					`Invalid input for "${featureId}:${channel}": ${
						error instanceof Error ? error.message : String(error)
					}`,
					"VALIDATION",
				);
			}
		}
		return (entry.handler as (args: unknown) => unknown | Promise<unknown>)(parsedArgs);
	}

	/**
	 * Check if a feature has a local handler for a channel.
	 */
	has(featureId: string, channel: string): boolean {
		return this.handlers.get(featureId)?.has(channel) ?? false;
	}

	/**
	 * Destroy a feature: run its disposables and remove all handlers.
	 * Shell-owned — called on feature/plugin unload or app shutdown.
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
