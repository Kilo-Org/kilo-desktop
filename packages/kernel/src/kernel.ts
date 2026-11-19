import {
	discoverPlugins,
	type ContextKeyRecord,
	type DiscoveredContribution,
	type DiscoveredPlugin,
	type DiscoveryResult,
	type KernelIssue,
} from "./discovery";
import { resolveContributionResources } from "./contribution-resources";
import { DisposableScope } from "./disposables";
import { DomainObjectRegistry, type DomainObjectSnapshot } from "./domain-object-registry";
import { KernelError } from "./errors";
import { ExtensionRegistry, windowOrigin } from "./extension-registry";
import { KERNEL_OWNER, ownerOf, type QualifiedId } from "./ids";
import type { PluginAssets } from "./host-services";
import type { PluginManifest } from "./manifest";
import type { PluginDefinitions, PluginRegistration } from "./plugin";
import {
	createPluginSdk,
	SILENT_LOGGER,
	type KernelLogger,
	type PluginHostServices,
	type PluginSdk,
} from "./sdk";
import { PortRegistry } from "./ports";
import type { KernelTransport } from "./transport";
import { ContextKeyStore, whenKeys, type ContextKeyValues } from "./when";

export type PluginState =
	| "resolved"
	| "unresolved"
	| "activating"
	| "active"
	| "deactivating"
	| "failed"
	| "disabled"
	/** Installed, but its manifest `when` doesn't hold; it activates once it does. */
	| "inactive";

export interface ActivationBudget {
	/** Log a warning when activation takes longer than this. */
	readonly warnMs: number;
	/** Fail and roll back an activation that takes longer than this. */
	readonly failMs: number;
}

/** States of a plugin the kernel won't run this launch, in any process. */
const NEVER_RUN: ReadonlySet<PluginState> = new Set(["unresolved", "disabled"]);

export const DEFAULT_ACTIVATION_BUDGET: ActivationBudget = { warnMs: 200, failMs: 10_000 };

/** Main answers hydration from memory, so this only trips when main is hung. */
export const DEFAULT_HYDRATE_TIMEOUT_MS = 30_000;

export interface KernelOptions {
	readonly process: "main" | "renderer";
	readonly windowId?: string;
	readonly registrations: readonly PluginRegistration[];
	readonly kernelDefinitions?: PluginDefinitions;
	readonly kernelContextKeys?: readonly ContextKeyRecord[];
	readonly transport?: KernelTransport;
	readonly logger?: KernelLogger;
	/** Checked after hydration; true skips plugin activation (safe mode). */
	readonly skipActivation?: () => boolean;
	/** Checked after hydration; true leaves the plugin `disabled`: never activated, no contributions. */
	readonly isDisabled?: (pluginId: string) => boolean;
	/** Runs before a plugin's `deactivate` (main: stops its services). */
	readonly beforeDeactivate?: (pluginId: string) => void | Promise<void>;
	/** Builds the host services injected into one plugin's sdk. */
	readonly hostServices?: (
		pluginId: string,
		manifest: PluginManifest | undefined,
	) => PluginHostServices;
	/**
	 * Main: plugins with a web (window) entry, the only plugins a window may
	 * call main's domain methods as. Omitted, any plugin the kernel runs
	 * qualifies.
	 */
	readonly webPlugins?: Iterable<string>;
}

export interface Kernel {
	readonly process: "main" | "renderer";
	readonly windowId?: string;
	readonly discovery: DiscoveryResult;
	readonly extensions: ExtensionRegistry;
	readonly domainObjects: DomainObjectRegistry;
	readonly contextKeys: ContextKeyStore;
	/** The kernel's own privileged sdk (owner `kernel`). */
	readonly kernelSdk: PluginSdk;
	activate(): Promise<void>;
	deactivate(): Promise<void>;
	/**
	 * Waits for in-flight cross-process deliveries and for plugins starting or
	 * stopping as their `when` changed (tests and browser mode).
	 */
	flush(): Promise<void>;
	pluginState(pluginId: string): PluginState | undefined;
	pluginStates(): Readonly<Record<string, PluginState>>;
	onPluginStateChange(listener: (pluginId: string, state: PluginState) => void): () => void;
	issues(): readonly KernelIssue[];
	onIssuesChange(listener: () => void): () => void;
	manifest(pluginId: string): PluginManifest | undefined;
	/** The sdk of a plugin's current activation. */
	sdkFor(pluginId: string): PluginSdk;
}

const CHANNELS = {
	hydrate: "kernel:hydrate",
	context: "kernel:context",
	implementations: "kernel:implementations",
} as const;

interface HydratePayload {
	readonly domainObjects: readonly DomainObjectSnapshot[];
	readonly context: ContextKeyValues;
	readonly implementations: Readonly<Record<string, readonly string[]>>;
}

interface Activation {
	readonly scope: DisposableScope;
	readonly sdk: PluginSdk;
	active: boolean;
}

/**
 * The plugin runtime for one process: discovers plugins, owns the extension
 * and domain registries and context keys, and activates plugins in `requires`
 * order with a time budget, isolating and rolling back failures. Lifecycle
 * phases, services and commands are layered on top by the main and renderer
 * kernels.
 *
 * A plugin with a manifest `when` (typically a feature flag) runs only while
 * it holds. It is checked at the plugin's turn in activation order, so keys
 * set by plugins activating before it (kilo.flags' cached flags) count; until
 * then it is `inactive` and none of its contributions are registered. After
 * the first pass the kernel follows the `when`'s keys, activating and
 * deactivating the plugin (with its manifest contributions) one change at a
 * time, always settling on the latest value. As at quit, plugins stop in
 * reverse activation order and `beforeDeactivate` (main: their services) runs
 * before each stops. Each process decides for itself
 * from the same mirrored global keys. A plugin that `required`s items from a
 * plugin behind a `when` stays unresolved for the launch if that plugin
 * starts inactive, so depend on such plugins `optional`ly.
 */
export function createKernel(options: KernelOptions): Kernel {
	const logger = options.logger ?? SILENT_LOGGER;
	const budget = DEFAULT_ACTIVATION_BUDGET;
	const discovery = discoverPlugins(options.registrations, {
		...(options.kernelDefinitions ? { kernelDefinitions: options.kernelDefinitions } : {}),
		...(options.kernelContextKeys ? { kernelContextKeys: options.kernelContextKeys } : {}),
	});
	let issues: readonly KernelIssue[] = [...discovery.issues];
	const issueListeners = new Set<() => void>();
	const addIssue = (issue: KernelIssue) => {
		issues = [...issues, issue];
		(issue.severity === "error" ? logger.error : logger.warn)(
			`[${issue.pluginId ?? KERNEL_OWNER}] ${issue.message}`,
		);
		for (const listener of [...issueListeners]) listener();
	};
	for (const issue of discovery.issues) {
		(issue.severity === "error" ? logger.error : logger.warn)(
			`[${issue.pluginId ?? KERNEL_OWNER}] ${issue.message}`,
		);
	}

	const manifests = new Map(
		discovery.plugins.map((plugin) => [plugin.manifest.id, plugin.manifest]),
	);
	const order = new Map(discovery.plugins.map((plugin, index) => [plugin.manifest.id, index]));

	const contextKeys = new ContextKeyStore();
	for (const key of discovery.contextKeys) contextKeys.declare({ id: key.id, scope: key.scope });

	const extensions = new ExtensionRegistry({
		process: options.process,
		extensionPoints: discovery.extensionPoints,
		contextKeys,
		pluginOrder: (pluginId) => order.get(pluginId) ?? (pluginId === KERNEL_OWNER ? -1 : Infinity),
		isInstalled: (pluginId) => pluginId === KERNEL_OWNER || order.has(pluginId),
		onDecisionError: (key, error) => logger.warn(`Decision handler "${key}" failed`, error),
	});

	const webPlugins = options.webPlugins ? new Set(options.webPlugins) : undefined;
	const domainObjects = new DomainObjectRegistry({
		process: options.process,
		domainObjects: discovery.domainObjects,
		...(options.transport ? { transport: options.transport } : {}),
		permissionsOf: (pluginId) => manifests.get(pluginId)?.permissions?.host ?? [],
		isWindowCaller: (pluginId) =>
			manifests.has(pluginId) &&
			(webPlugins?.has(pluginId) ?? true) &&
			!NEVER_RUN.has(states.get(pluginId) ?? "unresolved"),
		onUnexpectedError: (error) => logger.error("Domain object method failed", error),
		onListenerError: (error, source) => logger.error(`Domain object ${source} failed`, error),
	});

	const states = new Map<string, PluginState>(
		discovery.plugins.map((plugin) => [plugin.manifest.id, plugin.status]),
	);
	const stateListeners = new Set<(pluginId: string, state: PluginState) => void>();
	const setState = (pluginId: string, state: PluginState) => {
		states.set(pluginId, state);
		for (const listener of [...stateListeners]) listener(pluginId, state);
	};

	const activations = new Map<string, Activation>();
	const hostServicesFor = (pluginId: string, manifest: PluginManifest | undefined) =>
		options.hostServices?.(pluginId, manifest) ?? {};

	const ports = options.process === "main" ? new PortRegistry() : undefined;
	const kernelScope = new DisposableScope();
	const kernelSdk = createPluginSdk({
		pluginId: KERNEL_OWNER,
		process: options.process,
		...(options.windowId === undefined ? {} : { windowId: options.windowId }),
		scope: kernelScope,
		isActive: () => true,
		extensions,
		domainObjects,
		contextKeys,
		logger,
		host: hostServicesFor(KERNEL_OWNER, undefined),
		...(ports ? { ports } : {}),
		...(options.transport ? { transport: options.transport } : {}),
	});

	wireTransport(options, extensions, contextKeys, domainObjects);
	if (ports) {
		options.transport?.onPort?.((channel, payload, port, from) =>
			ports.dispatch(channel, payload, port, from),
		);
	}

	const createActivation = (plugin: DiscoveredPlugin): Activation => {
		const scope = new DisposableScope();
		const activation: Activation = {
			scope,
			active: false,
			sdk: createPluginSdk({
				pluginId: plugin.manifest.id,
				process: options.process,
				...(options.windowId === undefined ? {} : { windowId: options.windowId }),
				manifest: plugin.manifest,
				scope,
				isActive: () => activation.active,
				extensions,
				domainObjects,
				contextKeys,
				logger,
				host: hostServicesFor(plugin.manifest.id, plugin.manifest),
				...(ports ? { ports } : {}),
				...(options.transport ? { transport: options.transport } : {}),
			}),
		};
		return activation;
	};

	const requiredOwners = (plugin: DiscoveredPlugin): string[] =>
		Object.entries(plugin.manifest.requires ?? {})
			.filter(([, strength]) => strength === "required")
			.map(([item]) => ownerOf(item as QualifiedId))
			.filter((owner) => owner !== KERNEL_OWNER && owner !== plugin.manifest.id);

	const activatePlugin = async (plugin: DiscoveredPlugin): Promise<void> => {
		const pluginId = plugin.manifest.id;
		const blockedBy = requiredOwners(plugin).find((owner) => states.get(owner) !== "active");
		if (blockedBy !== undefined) {
			extensions.removePlugin(pluginId);
			setState(pluginId, "unresolved");
			addIssue({
				severity: "error",
				code: "dependency-unavailable",
				message: `Not activated: requires items from "${blockedBy}", which is ${
					states.get(blockedBy) === "disabled" ? "turned off" : "not active"
				}.`,
				pluginId,
			});
			return;
		}
		const activation = createActivation(plugin);
		activation.active = true;
		activations.set(pluginId, activation);
		setState(pluginId, "activating");
		const started = Date.now();
		try {
			if (plugin.entry) {
				await withTimeout(
					Promise.resolve().then(() => plugin.entry!.activate(activation.sdk)),
					budget.failMs,
					() => new KernelError("TIMEOUT", `Activation exceeded ${budget.failMs} ms.`),
				);
			}
			const elapsed = Date.now() - started;
			if (elapsed > budget.warnMs) {
				logger.warn(
					`Plugin "${pluginId}" took ${elapsed} ms to activate (budget ${budget.warnMs} ms).`,
				);
			}
			setState(pluginId, "active");
		} catch (error) {
			activation.active = false;
			activations.delete(pluginId);
			await activation.scope.dispose((disposeError) =>
				logger.error(`Rollback of "${pluginId}" failed`, disposeError),
			);
			extensions.removePlugin(pluginId);
			setState(pluginId, "failed");
			const timedOut = error instanceof KernelError && error.code === "TIMEOUT";
			addIssue({
				severity: "error",
				code: timedOut ? "activation-timeout" : "activation-failed",
				message: timedOut
					? `Activation exceeded ${budget.failMs} ms and was rolled back.`
					: `Activation failed: ${error instanceof Error ? error.message : String(error)}`,
				pluginId,
			});
		}
	};

	const deactivatePlugin = async (
		pluginId: string,
		endState: PluginState = "resolved",
	): Promise<void> => {
		const activation = activations.get(pluginId);
		if (!activation) return;
		setState(pluginId, "deactivating");
		const entry = discovery.plugins.find((plugin) => plugin.manifest.id === pluginId)?.entry;
		try {
			await options.beforeDeactivate?.(pluginId);
		} catch (error) {
			logger.error(`Preparing "${pluginId}" to deactivate failed`, error);
		}
		try {
			if (entry?.deactivate) {
				await withTimeout(
					Promise.resolve().then(() => entry.deactivate!()),
					budget.failMs,
					() => new KernelError("TIMEOUT", `Deactivation exceeded ${budget.failMs} ms.`),
				);
			}
		} catch (error) {
			logger.error(`Plugin "${pluginId}" failed to deactivate cleanly`, error);
		}
		activation.active = false;
		await activation.scope.dispose((error) =>
			logger.error(`Disposal of "${pluginId}" failed`, error),
		);
		activations.delete(pluginId);
		extensions.removePlugin(pluginId);
		setState(pluginId, endState);
	};

	const gated = discovery.plugins.filter((plugin) => plugin.manifest.when !== undefined);
	const whenHolds = (plugin: DiscoveredPlugin) => contextKeys.evaluate(plugin.manifest.when);
	const withResources = (contribution: DiscoveredContribution): DiscoveredContribution => {
		const point = discovery.extensionPoints.get(contribution.pointId)?.definition;
		if (options.process !== "main" || !point?.resources) return contribution;
		const host = hostServicesFor(contribution.pluginId, manifests.get(contribution.pluginId));
		return resolveContributionResources(
			contribution,
			(host as { readonly assets?: PluginAssets }).assets,
			(reason) =>
				logger.warn(
					`Left \${resources} unresolved in "${contribution.pluginId}/${contribution.entry.id}": ${reason}.`,
				),
		);
	};
	const addManifestContributions = (pluginId: string) => {
		for (const contribution of discovery.contributions) {
			if (contribution.pluginId === pluginId) {
				extensions.addManifestContribution(withResources(contribution));
			}
		}
	};
	const startGated = async (plugin: DiscoveredPlugin): Promise<void> => {
		addManifestContributions(plugin.manifest.id);
		await activatePlugin(plugin);
	};

	/** Brings a plugin behind a `when` in line with it; calls are serialised through `followWhen`. */
	const reconcile = async (plugin: DiscoveredPlugin): Promise<void> => {
		const pluginId = plugin.manifest.id;
		const state = states.get(pluginId);
		if (whenHolds(plugin)) {
			if (state === "inactive") await startGated(plugin);
		} else if (state === "active") {
			await deactivatePlugin(pluginId, "inactive");
		}
	};
	let reconciling: Promise<void> = Promise.resolve();
	let stopFollowing: (() => void) | undefined;
	const followWhen = (plugins: readonly DiscoveredPlugin[]) => {
		// Stops in reverse activation order, so a plugin stops before those it uses, as at quit.
		const stopping = plugins.filter((plugin) => !whenHolds(plugin)).reverse();
		const starting = plugins.filter((plugin) => whenHolds(plugin));
		for (const plugin of [...stopping, ...starting]) {
			// Re-reads the `when` when its turn comes, so a burst of changes settles on the latest.
			reconciling = reconciling
				.then(() => reconcile(plugin))
				.catch((error) =>
					logger.error(`Following the \`when\` of "${plugin.manifest.id}" failed`, error),
				);
		}
	};

	const hydrate = async (): Promise<void> => {
		if (options.process !== "renderer" || !options.transport) return;
		const timeoutMs = DEFAULT_HYDRATE_TIMEOUT_MS;
		const payload = (await withTimeout(
			options.transport.request(CHANNELS.hydrate, null),
			timeoutMs,
			() => new KernelError("TIMEOUT", `The main process did not answer within ${timeoutMs} ms.`),
		)) as HydratePayload;
		domainObjects.hydrate(payload.domainObjects);
		contextKeys.replaceScope("global", payload.context);
		extensions.setRemoteImplementations("main", payload.implementations);
	};

	return {
		process: options.process,
		...(options.windowId === undefined ? {} : { windowId: options.windowId }),
		discovery,
		extensions,
		domainObjects,
		contextKeys,
		kernelSdk,
		async activate() {
			await hydrate();
			if (options.skipActivation?.()) return;
			for (const plugin of discovery.plugins) {
				if (options.isDisabled?.(plugin.manifest.id)) setState(plugin.manifest.id, "disabled");
			}
			for (const contribution of discovery.contributions) {
				if (
					states.get(contribution.pluginId) === "resolved" &&
					manifests.get(contribution.pluginId)?.when === undefined
				) {
					extensions.addManifestContribution(withResources(contribution));
				}
			}
			for (const plugin of discovery.plugins) {
				if (plugin.status !== "resolved" || states.get(plugin.manifest.id) !== "resolved") continue;
				// Plugins activate one at a time in dependency order so each sees its dependencies active.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				if (plugin.manifest.when === undefined) await activatePlugin(plugin);
				else if (whenHolds(plugin)) await startGated(plugin);
				else setState(plugin.manifest.id, "inactive");
			}
			if (gated.length === 0) return;
			stopFollowing = contextKeys.subscribe((changed) => {
				followWhen(
					gated.filter((plugin) => whenKeys(plugin.manifest.when).some((key) => changed.has(key))),
				);
			});
			// Catch up on changes made while later plugins were still activating.
			followWhen(gated);
		},
		async deactivate() {
			stopFollowing?.();
			stopFollowing = undefined;
			await reconciling;
			for (const plugin of [...discovery.plugins].reverse()) {
				// Deactivate in reverse dependency order so no plugin outlives a dependent.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await deactivatePlugin(plugin.manifest.id);
			}
		},
		async flush() {
			await options.transport?.flush?.();
			await reconciling;
		},
		pluginState: (pluginId) => states.get(pluginId),
		pluginStates: () => Object.fromEntries(states),
		onPluginStateChange(listener) {
			stateListeners.add(listener);
			return () => stateListeners.delete(listener);
		},
		issues: () => issues,
		onIssuesChange(listener) {
			issueListeners.add(listener);
			return () => issueListeners.delete(listener);
		},
		manifest: (pluginId) => manifests.get(pluginId),
		sdkFor(pluginId) {
			if (pluginId === KERNEL_OWNER) return kernelSdk;
			const activation = activations.get(pluginId);
			if (!activation) {
				throw new KernelError("UNAVAILABLE", `Plugin "${pluginId}" is not active.`);
			}
			return activation.sdk;
		},
	};
}

function wireTransport(
	options: KernelOptions,
	extensions: ExtensionRegistry,
	contextKeys: ContextKeyStore,
	domainObjects: DomainObjectRegistry,
): void {
	const { transport } = options;
	if (!transport) return;
	if (options.process === "main") {
		transport.handle(CHANNELS.hydrate, (_payload, from): HydratePayload => {
			// A window hydrates once per page load: whatever it implemented before a reload is gone.
			if (from.process === "renderer")
				extensions.clearRemoteImplementations(windowOrigin(from.windowId));
			return {
				domainObjects: domainObjects.snapshot(),
				context: contextKeys.snapshot("global"),
				implementations: extensions.localImplementations(),
			};
		});
		contextKeys.subscribe(() => transport.send(CHANNELS.context, contextKeys.snapshot("global")));
		extensions.onLocalImplementationsChange(() =>
			transport.send(CHANNELS.implementations, extensions.localImplementations()),
		);
		transport.on(CHANNELS.implementations, (payload, from) => {
			if (from.process !== "renderer") return;
			extensions.setRemoteImplementations(
				windowOrigin(from.windowId),
				payload as Record<string, string[]>,
			);
		});
	} else {
		transport.on(CHANNELS.context, (payload) =>
			contextKeys.replaceScope("global", payload as ContextKeyValues),
		);
		transport.on(CHANNELS.implementations, (payload) =>
			extensions.setRemoteImplementations("main", payload as Record<string, string[]>),
		);
		extensions.onLocalImplementationsChange(() =>
			transport.send(CHANNELS.implementations, extensions.localImplementations()),
		);
	}
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(onTimeout()), ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
