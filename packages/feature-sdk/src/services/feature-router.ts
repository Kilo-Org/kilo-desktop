import type {
	ChannelHandlerInput,
	ChannelHandlerMap,
	ChannelHandlerOutput,
	ChannelMap,
} from "../channel-map.js";
import { FeatureError } from "../errors.js";
import type {
	ChannelHandlers,
	HostMessagePort,
	HostPortContext,
	KvStore,
	KvStoreFactory,
	KvStoreOptions,
	MainSdk,
	MainSdkFetch,
	MainSdkHost,
	MainSdkLogger,
	MainSdkProtocol,
	MainSdkStorage,
} from "../types/sdk.js";
import type { SchemaLike } from "../types/schema.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { emitFeatureEvent, EventBus, type FeatureEvent } from "./event-bus.js";

const KV_NAMESPACE_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertValidKvNamespace(namespace: string): void {
	if (!KV_NAMESPACE_PATTERN.test(namespace)) {
		throw new Error(
			`[FeatureRouter] Invalid KV namespace "${namespace}": must match ${KV_NAMESPACE_PATTERN.source}. ` +
				`Path separators, "..", and empty names would escape the feature's storage sandbox.`,
		);
	}
}

type Handler = (args: unknown) => unknown | Promise<unknown>;
type FeatureDisposer = () => unknown;
interface PortHandlerEntry {
	argsSchema: SchemaLike;
	handler: (port: HostMessagePort, args: unknown, context: HostPortContext) => void | Promise<void>;
}

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
	/** Narrow shell-owned desktop capabilities. Browser mode omits this. */
	host?: MainSdkHost;
	/** Custom protocol delegate (manifest-declared schemes). Browser mode omits this. */
	protocol?: MainSdkProtocol;
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
	/** Open a typed key/value store scoped to this feature. */
	createKvStore?: KvStoreFactory;
	/**
	 * Receive boot-time progress messages from this feature's `mainRegister`.
	 * The caller (typically `bootFeatures`) is responsible for gating this to
	 * the boot window and dropping it when boot completes — the SDK never
	 * checks a lifecycle flag of its own.
	 */
	reportBootProgress?: (message: string) => void;
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
	private disposables = new Map<string, FeatureDisposer[]>();
	private portHandlers = new Map<string, Map<string, PortHandlerEntry>>();
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
		if (!this.portHandlers.has(featureId)) {
			this.portHandlers.set(featureId, new Map());
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
		const createKvStore = options?.createKvStore;
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

		const reportBootProgress = options?.reportBootProgress;
		const boot: MainSdk["boot"] = {
			reportProgress: (message: string) => {
				// Absent reporter (built-in features, tests that don't opt in) or a
				// caller-gated no-op after boot completes both fall through silently
				// — the SDK never owns the "still booting?" flag.
				reportBootProgress?.(message);
			},
		};
		const ports: MainSdk["ports"] = {
			handle: (channel, argsSchema, handler) => {
				const registeredPorts = this.portHandlers.get(featureId)!;
				if (registeredPorts.has(channel)) {
					console.warn(
						`[FeatureRouter] Port handler for "${featureId}:${channel}" registered twice — replacing.`,
					);
				}
				registeredPorts.set(channel, {
					argsSchema,
					handler: handler as PortHandlerEntry["handler"],
				});
			},
		};

		const kvStores = new Map<string, KvStore<Record<string, unknown>>>();
		const storage: MainSdkStorage = {
			kv: <T extends Record<string, unknown>>(kvOptions: KvStoreOptions<T>): KvStore<T> => {
				if (!createKvStore) {
					throw new Error(
						`[FeatureRouter] Feature "${featureId}" has no key/value storage in this ` +
							`environment (browser mode provides no persistent storage).`,
					);
				}
				const namespace = kvOptions.namespace ?? "kv";
				assertValidKvNamespace(namespace);
				const cached = kvStores.get(namespace);
				if (cached) return cached as KvStore<T>;
				const store = createKvStore<T>(kvOptions);
				kvStores.set(namespace, store as KvStore<Record<string, unknown>>);
				return store;
			},
		};

		return {
			featureId,
			logger,
			net: { fetch: fetchImpl },
			events,
			plugins,
			boot,
			storage,
			ports,
			host: options?.host,
			protocol: options?.protocol,
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
			onDispose: (fn: () => unknown) => {
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

	/** Attach a transferred host port to the feature-scoped main handler. */
	async connectPort(
		featureId: string,
		channel: string,
		port: HostMessagePort,
		args?: unknown,
		context: HostPortContext = { senderId: -1 },
	): Promise<void> {
		const entry = this.portHandlers.get(featureId)?.get(channel);
		if (!entry) {
			throw new FeatureError(
				`No port handler for channel "${channel}" in feature "${featureId}".`,
				"NOT_FOUND",
			);
		}

		let parsedArgs: unknown;
		try {
			parsedArgs = entry.argsSchema.parse(args);
		} catch (error) {
			throw new FeatureError(
				`Invalid input for port "${featureId}:${channel}": ${
					error instanceof Error ? error.message : String(error)
				}`,
				"VALIDATION",
			);
		}

		let portClosed = false;
		const closePort = () => {
			if (portClosed) return;
			portClosed = true;
			port.close();
		};
		this.disposables.get(featureId)!.push(closePort);
		try {
			await entry.handler(port, parsedArgs, context);
		} catch (error) {
			const disposables = this.disposables.get(featureId);
			const index = disposables?.indexOf(closePort) ?? -1;
			if (index >= 0) disposables!.splice(index, 1);
			throw error;
		}
	}

	/**
	 * Check if a feature has a local handler for a channel.
	 */
	has(featureId: string, channel: string): boolean {
		return this.handlers.get(featureId)?.has(channel) ?? false;
	}

	/**
	 * Destroy a feature synchronously. Promise-returning cleanup continues in
	 * the background; Electron shutdown uses destroyFeatureAsync instead.
	 */
	destroyFeature(featureId: string): void {
		for (const fn of this.#takeDisposables(featureId)) {
			try {
				void Promise.resolve(fn()).catch((error: unknown) => this.#warnDispose(featureId, error));
			} catch (error) {
				this.#warnDispose(featureId, error);
			}
		}
	}

	/** Destroy a feature and await each disposer in reverse registration order. */
	async destroyFeatureAsync(featureId: string): Promise<void> {
		for (const fn of this.#takeDisposables(featureId)) {
			try {
				await fn();
			} catch (error) {
				this.#warnDispose(featureId, error);
			}
		}
	}

	#takeDisposables(featureId: string): FeatureDisposer[] {
		const disposables = [...(this.disposables.get(featureId) ?? [])].reverse();
		this.handlers.delete(featureId);
		this.portHandlers.delete(featureId);
		this.disposables.delete(featureId);
		return disposables;
	}

	#warnDispose(featureId: string, error: unknown): void {
		console.warn(`[FeatureRouter] Dispose callback for "${featureId}" threw:`, error);
	}
}
