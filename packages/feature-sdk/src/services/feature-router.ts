import type {
	ChannelHandlerInput,
	ChannelHandlerMap,
	ChannelHandlerOutput,
	ChannelMap,
} from "../channel-map.js";
import { FeatureError } from "../errors.js";
import type { ChannelHandlers, MainSdk, MainSdkFetch, MainSdkLogger } from "../types/sdk.js";
import type { SchemaLike } from "../types/schema.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { emitFeatureEvent, EventBus, type FeatureEvent } from "./event-bus.js";

type Handler = (args: unknown) => unknown | Promise<unknown>;

interface HandlerEntry {
	inputSchema: SchemaLike;
	outputSchema: SchemaLike;
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
	/** Adopt an existing process-local bus; otherwise the router creates and owns one. */
	eventBus?: EventBus;
	/** Adopt an existing process-local registry; otherwise the router creates and owns one. */
	capabilityRegistry?: CapabilityRegistry;
}

export interface CreateMainSdkOptions {
	/** Optional main-to-renderer relay. Browser mode omits it. */
	emitEvent?: (event: FeatureEvent) => void;
	/** Feature-scoped host logger. Defaults to a console-backed logger. */
	logger?: MainSdkLogger;
	/** Host fetch implementation. Defaults to the current runtime's global fetch. */
	fetch?: MainSdkFetch;
	/**
	 * Resolve (and create, if needed) the feature's storage directory.
	 * Called lazily on first `mainSdk.storageDir` access and cached.
	 * Omit in environments without storage (browser mode) — access then throws.
	 */
	resolveStorageDir?: () => string;
	/**
	 * Resolve a subpath inside the plugin's installed package to an absolute
	 * filesystem path. Backs `mainSdk.resolvePluginAsset(subpath)`. Omit for
	 * built-in features (they ship no assets) and browser mode — calling
	 * `resolvePluginAsset` then throws.
	 */
	resolvePluginAsset?: (subpath: string) => string;
}

function createConsoleLogger(featureId: string): MainSdkLogger {
	const prefix = `[${featureId}]`;
	return {
		info: (message, ...args) => console.info(prefix, message, ...args),
		warn: (message, ...args) => console.warn(prefix, message, ...args),
		error: (message, ...args) => console.error(prefix, message, ...args),
	};
}

/**
 * Process-local runtime spine backing `sdk.invoke`, `mainSdk.channels`, events,
 * and cross-feature capabilities. SDK and MainSdk facades always use the bus
 * and capability registry owned by this router, so those surfaces cannot drift
 * onto disconnected service instances.
 *
 * Shell infrastructure — features never construct this; they register
 * handlers through the MainSdk given to mainRegister() and call them
 * through sdk.invoke().
 *
 * Deployment shapes:
 * - Electron main: features populate it at boot; the "feature:invoke" IPC
 *   handler calls invoke().
 * - Renderer (Electron mode): empty of local handlers; every invoke() goes
 *   through the injected fallback (IPC bridge).
 * - Renderer (browser mode): features boot in-process; invoke() hits local
 *   handlers directly. Local handlers always win over the fallback.
 *
 * Input and output schemas from the feature's channel map are parsed here at
 * the routing boundary. Invalid input throws FeatureError("VALIDATION");
 * invalid handler output is an internal error.
 */
export class FeatureRouter {
	private handlers = new Map<string, Map<string, HandlerEntry>>();
	private disposables = new Map<string, Array<() => void>>();
	private readonly fallback: InvokeFallback | undefined;
	readonly eventBus: EventBus;
	readonly capabilityRegistry: CapabilityRegistry;

	constructor(options?: FeatureRouterOptions) {
		this.fallback = options?.fallback;
		this.eventBus = options?.eventBus ?? new EventBus();
		this.capabilityRegistry = options?.capabilityRegistry ?? new CapabilityRegistry();
	}

	/**
	 * Create a MainSdk instance scoped to a specific feature.
	 * The feature uses this to register its handlers.
	 */
	createMainSdk(featureId: string, options?: CreateMainSdkOptions): MainSdk {
		if (!this.handlers.has(featureId)) {
			this.handlers.set(featureId, new Map());
		}
		if (!this.disposables.has(featureId)) {
			this.disposables.set(featureId, []);
		}

		const channels = <C extends ChannelMap>(channelMap: C): ChannelHandlers<C> => {
			const handle = <K extends keyof C & string>(
				channel: K,
				handler: (
					args: ChannelHandlerInput<C[K]>,
				) => ChannelHandlerOutput<C[K]> | Promise<ChannelHandlerOutput<C[K]>>,
			) => {
				const method = channelMap[channel]!;
				const registeredChannels = this.handlers.get(featureId)!;
				if (registeredChannels.has(channel)) {
					console.warn(
						`[FeatureRouter] Handler for "${featureId}:${channel}" registered twice — replacing.`,
					);
				}
				registeredChannels.set(channel, {
					inputSchema: method.input,
					outputSchema: method.output,
					handler: (args) => handler(args as ChannelHandlerInput<C[K]>),
				});
			};

			return {
				handle,
				handleAll: (handlers: ChannelHandlerMap<C>) => {
					// Iterate the channel map (not the handlers object) so the map
					// stays the source of truth for which channels must exist.
					for (const channel of Object.keys(channelMap) as Array<keyof C & string>) {
						handle(channel, handlers[channel]);
					}
				},
			};
		};

		const resolveStorageDir = options?.resolveStorageDir;
		const resolvePluginAsset = options?.resolvePluginAsset;
		const logger = options?.logger ?? createConsoleLogger(featureId);
		const fetchImpl: MainSdkFetch =
			options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
		let storageDir: string | undefined;
		const disposables = this.disposables.get(featureId)!;
		const exposedCapabilities = new Set<string>();

		const events: MainSdk["events"] = {
			emit: (name, payload) => {
				emitFeatureEvent(this.eventBus, { featureId, name, payload }, options?.emitEvent);
			},
			on: (event, handler) => {
				if (!event.includes(".")) {
					console.warn(
						`[MainSdk] events.on("${event}") has no feature namespace — events are always ` +
							`"featureId.eventName". Did you mean "${featureId}.${event}"?`,
					);
				}
				const unsubscribe = this.eventBus.on(event, handler);
				const dispose = () => {
					const index = disposables.indexOf(dispose);
					if (index >= 0) disposables.splice(index, 1);
					unsubscribe();
				};
				disposables.push(dispose);
				return dispose;
			},
		};

		const plugins: MainSdk["plugins"] = {
			expose: (capabilityName, implementation) => {
				this.capabilityRegistry.expose(featureId, capabilityName, implementation);
				if (!exposedCapabilities.has(capabilityName)) {
					exposedCapabilities.add(capabilityName);
					disposables.push(() => this.capabilityRegistry.remove(featureId, capabilityName));
				}
			},
			get: <T extends Record<string, unknown> = Record<string, unknown>>(targetFeatureId: string) =>
				this.capabilityRegistry.get(targetFeatureId) as T | null,
		};

		return {
			featureId,
			logger,
			net: { fetch: fetchImpl },
			events,
			plugins,
			get storageDir(): string {
				if (!resolveStorageDir) {
					throw new Error(
						`[FeatureRouter] Feature "${featureId}" has no storage directory in this ` +
							`environment (browser mode provides no storage).`,
					);
				}
				storageDir ??= resolveStorageDir();
				return storageDir;
			},
			resolvePluginAsset: (subpath: string) => {
				if (!resolvePluginAsset) {
					throw new Error(
						`[FeatureRouter] Feature "${featureId}" has no plugin asset directory in this ` +
							`environment — resolvePluginAsset is only available to plugins booted from a ` +
							`discovered manifest (built-in features and browser mode do not ship assets).`,
					);
				}
				return resolvePluginAsset(subpath);
			},
			channels,
			onDispose: (fn: () => void) => {
				this.disposables.get(featureId)!.push(fn);
			},
		};
	}

	/**
	 * Invoke a handler. Used by the SDK's sdk.invoke() and by the IPC bridge.
	 * Validates args against the handler's input schema before invoking, and
	 * the result against the output schema.
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

		let parsedArgs: unknown;
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

		const rawOutput = await entry.handler(parsedArgs);

		try {
			return entry.outputSchema.parse(rawOutput);
		} catch (error) {
			throw new Error(`Handler for "${featureId}:${channel}" returned invalid output.`, {
				cause: error,
			});
		}
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
			for (const fn of [...disposables].reverse()) {
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
