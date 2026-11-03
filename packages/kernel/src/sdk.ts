import type { DisposableScope, Disposer } from "./disposables";
import type { AnyDomain } from "./domain";
import type {
	DomainHandle,
	DomainImpl,
	DomainProvider,
	DomainRegistry,
	DomainTracker,
} from "./domain-registry";
import { KernelError } from "./errors";
import type {
	AnyExtensionPoint,
	ContributionEntry,
	DecisionHandler,
	ExtensionPoint,
	ImplementationOf,
} from "./extension-point";
import type {
	Contribution,
	DecisionOutcome,
	ExclusiveResolution,
	ExtensionRegistry,
} from "./extension-registry";
import { qualify, type QualifiedId } from "./ids";
import type { PluginManifest } from "./manifest";
import type { PortHandler, PortRegistry } from "./ports";
import type { KernelTransport } from "./transport";
import type { ContextKeyStore, WhenExpression } from "./when";

export interface KernelLogger {
	debug(message: string, ...details: unknown[]): void;
	info(message: string, ...details: unknown[]): void;
	warn(message: string, ...details: unknown[]): void;
	error(message: string, ...details: unknown[]): void;
}

export const SILENT_LOGGER: KernelLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

export interface ContributionHandle {
	readonly key: QualifiedId;
	update(patch: Readonly<Record<string, unknown>>): void;
	remove(): void;
}

export type DecisionInputOf<TPoint> =
	ImplementationOf<TPoint> extends DecisionHandler<infer TInput> ? TInput : never;

export interface PluginExtensions {
	/** Binds code to one of this plugin's contributions. */
	implement<TPoint extends AnyExtensionPoint>(
		point: TPoint,
		id: string,
		implementation: ImplementationOf<TPoint>,
	): () => void;
	/** Adds a runtime contribution (validated like a manifest entry). */
	add<TPoint extends AnyExtensionPoint>(
		point: TPoint,
		entry: ContributionEntry<TPoint>,
		implementation?: ImplementationOf<TPoint>,
	): ContributionHandle;
	list<TPoint extends AnyExtensionPoint>(point: TPoint): readonly Contribution<TPoint>[];
	exclusive<TPoint extends AnyExtensionPoint>(point: TPoint): ExclusiveResolution<TPoint>;
	subscribe(point: AnyExtensionPoint, listener: () => void): () => void;
	/** Runs a decision point this plugin owns. */
	decide<TPoint extends ExtensionPoint<unknown, DecisionHandler<never>, "decision">>(
		point: TPoint,
		input: DecisionInputOf<TPoint>,
	): Promise<DecisionOutcome>;
}

export interface PluginDomains {
	provide<TDomain extends AnyDomain>(
		domain: TDomain,
		impl: DomainImpl<TDomain>,
	): DomainProvider<TDomain>;
	get<TDomain extends AnyDomain>(domain: TDomain): DomainHandle<TDomain> | null;
	track<TDomain extends AnyDomain>(domain: TDomain, tracker: DomainTracker<TDomain>): () => void;
}

export interface PluginContext {
	/** Sets one of this plugin's context keys, by local name. */
	set(key: string, value: boolean): void;
	get(key: string): boolean;
	evaluate(when: WhenExpression | undefined): boolean;
	subscribe(listener: () => void): () => void;
}

/** Per-plugin services injected by the host (storage, files, network…). */
export interface PluginHostServices {
	readonly [service: string]: unknown;
}

export interface PluginSdk {
	readonly pluginId: string;
	readonly process: "main" | "renderer";
	readonly windowId?: string;
	readonly manifest?: PluginManifest;
	readonly extensions: PluginExtensions;
	readonly domains: PluginDomains;
	readonly context: PluginContext;
	readonly logger: KernelLogger;
	/** Host-provided per-plugin services; see the host package for their types. */
	readonly host: PluginHostServices;
	/**
	 * Message ports between a plugin's renderer and main halves, for streams
	 * (terminal I/O). A renderer opens one of its own plugin's ports by name;
	 * main handles it.
	 */
	readonly ports: PluginPorts;
	/** Registers cleanup to run when the plugin deactivates. */
	onDispose(disposer: Disposer): () => void;
}

export interface PluginPorts {
	/** Main: handles the ports this plugin's renderers open under `name`. */
	handle(name: string, handler: PortHandler): () => void;
	/** Renderer: opens a port to this plugin's main handler for `name`; transferable (to a frame). */
	open(name: string, args?: unknown): MessagePort;
}

export interface SdkDependencies {
	readonly pluginId: string;
	readonly process: "main" | "renderer";
	readonly windowId?: string;
	readonly manifest?: PluginManifest;
	readonly scope: DisposableScope;
	readonly isActive: () => boolean;
	readonly extensions: ExtensionRegistry;
	readonly domains: DomainRegistry;
	readonly contextKeys: ContextKeyStore;
	readonly logger: KernelLogger;
	readonly host: PluginHostServices;
	readonly ports?: PortRegistry;
	readonly transport?: KernelTransport;
}

export function createPluginSdk(deps: SdkDependencies): PluginSdk {
	const { pluginId, scope, extensions, domains, contextKeys } = deps;
	const assertActive = () => {
		if (!deps.isActive()) {
			throw new KernelError("UNAVAILABLE", `Plugin "${pluginId}" is not active.`);
		}
	};
	const track = (dispose: () => void) => scope.add(dispose);

	return {
		pluginId,
		process: deps.process,
		...(deps.windowId === undefined ? {} : { windowId: deps.windowId }),
		...(deps.manifest === undefined ? {} : { manifest: deps.manifest }),
		logger: deps.logger,
		host: deps.host,
		extensions: {
			implement(point, id, implementation) {
				assertActive();
				return scope.add(extensions.implement(pluginId, point, id, implementation));
			},
			add(point, entry, implementation) {
				assertActive();
				const record = extensions.add(
					pluginId,
					point,
					entry as unknown as Readonly<Record<string, unknown>>,
					implementation,
				);
				const remove = scope.add(() => extensions.remove(point.id, record.key));
				return {
					key: record.key,
					update: (patch) => extensions.update(point.id, record.key, patch),
					remove,
				};
			},
			list: (point) => extensions.list(point),
			exclusive: (point) => extensions.exclusive(point),
			subscribe(point, listener) {
				return scope.add(
					extensions.subscribe((pointId) => {
						if (pointId === point.id) listener();
					}),
				);
			},
			async decide(point, input) {
				if (extensions.point(point.id).owner !== pluginId) {
					throw new KernelError(
						"PERMISSION_DENIED",
						`Only the owner of "${point.id}" can run its decisions.`,
					);
				}
				return extensions.decide(point, input);
			},
		},
		domains: {
			provide(domain, impl) {
				assertActive();
				const { provider, withdraw } = domains.provide(pluginId, domain, impl);
				scope.add(withdraw);
				return provider;
			},
			get: (domain) => domains.get(pluginId, domain, track),
			track(domain, tracker) {
				return scope.add(domains.track(pluginId, domain, tracker, track));
			},
		},
		context: {
			set(key, value) {
				assertActive();
				const qualified = qualify(pluginId, key);
				const declaration = contextKeys.declarationFor(qualified);
				if (declaration && (declaration.scope === "global") !== (deps.process === "main")) {
					throw new KernelError(
						"VALIDATION",
						`Context key "${qualified}" is ${declaration.scope}-scoped and must be set in the ${declaration.scope === "global" ? "main" : "renderer"} process.`,
					);
				}
				contextKeys.set(pluginId, qualified, value);
			},
			get: (key) => contextKeys.get(key),
			evaluate: (when) => contextKeys.evaluate(when),
			subscribe: (listener) => scope.add(contextKeys.subscribe(() => listener())),
		},
		ports: {
			handle(name, handler) {
				assertActive();
				if (deps.process !== "main" || !deps.ports) {
					throw new KernelError("UNAVAILABLE", "Ports are handled in the main process.");
				}
				return scope.add(deps.ports.handle(qualify(pluginId, name), handler));
			},
			open(name, args) {
				assertActive();
				if (deps.process !== "renderer" || !deps.transport?.openPort) {
					throw new KernelError("UNAVAILABLE", "Ports are opened from a window.");
				}
				const channel = new MessageChannel();
				deps.transport.openPort(qualify(pluginId, name), args ?? null, channel.port2);
				return channel.port1;
			},
		},
		onDispose: (disposer) => scope.add(disposer),
	};
}
