import type {
	ContributionOptions,
	DispatchIntent,
	NavigateOptions,
	SDK,
	SdkAuth,
	SdkClient,
	SdkCommands,
	SdkEvents,
	SdkFs,
	SdkIntents,
	SdkLocation,
	SdkNavigation,
	SdkNotifications,
	SdkPlugins,
	SdkShell,
	SdkState,
	SdkTheme,
	SdkTools,
	ShellFsDelegate,
	ShellLocation,
} from "../types/sdk.js";
import type { CommandRegistry } from "./command-registry.js";
import type { ContributionRegistry } from "./contribution-registry.js";
import { emitFeatureEvent, type FeatureEvent } from "./event-bus.js";
import type { FeatureRouter } from "./feature-router.js";
import type { StateBroker } from "./state-broker.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface ShellDelegates {
	notifications: SdkNotifications;
	theme: SdkTheme;
	auth: SdkAuth;
	shell: SdkShell;
	/**
	 * Scoped filesystem over the per-feature sandbox
	 * (`${userData}/plugins/<id>/`). The host implements this once; createSdk
	 * binds the calling feature's id so `sdk.fs` cannot reach another
	 * feature's sandbox.
	 */
	fs: ShellFsDelegate;
	/**
	 * Navigation over the shell's internal router (Decision #19). Exposed to
	 * features as `sdk.navigate` + `sdk.location`; the router itself never
	 * crosses the SDK boundary.
	 */
	navigation: SdkNavigation;
}

export interface SdkFactoryServices {
	/** Optional renderer-to-main transport. Browser mode omits it. */
	emitEvent?: (event: FeatureEvent) => void;
	stateBroker: StateBroker;
	contributionRegistry: ContributionRegistry;
	commandRegistry: CommandRegistry;
	/** AI-runtime tool registry backing `sdk.tools`. */
	toolRegistry: ToolRegistry;
	/** Canonical owner of handlers, events, and process-local capabilities. */
	featureRouter: FeatureRouter;
	shellDelegates: ShellDelegates;
}

/**
 * Create a scoped SDK instance for a feature.
 *
 * Shell infrastructure — feature code never calls this; it receives SDK
 * instances via useSdk(featureId) in the renderer, where the shell caches
 * one instance per feature.
 *
 * Everything registered THROUGH the instance (event subscriptions, stores,
 * capabilities, contributions, commands, onDispose callbacks) is tracked and
 * cleaned up by destroy(). destroy() deliberately does NOT touch the feature's
 * backend handlers or registrations made by other SDK instances of the same
 * feature — full feature teardown is shell-owned (see teardownFeature).
 */
export function createSdk(featureId: string, services: SdkFactoryServices): SDK {
	const disposables = new Set<() => void>();
	const { capabilityRegistry, eventBus } = services.featureRouter;
	let destroyed = false;

	function assertAlive(): void {
		if (destroyed) {
			throw new Error(`SDK for feature "${featureId}" has been destroyed.`);
		}
	}

	// ─── Events ────────────────────────────────────────────────────────────────

	const events: SdkEvents = {
		emit(event: string, payload?: unknown) {
			assertAlive();
			emitFeatureEvent(eventBus, { featureId, name: event, payload }, services.emitEvent);
		},
		on(event: string, handler: (payload: unknown) => void) {
			assertAlive();
			if (!event.includes(".")) {
				console.warn(
					`[SDK] events.on("${event}") has no feature namespace — events are always ` +
						`"featureId.eventName". Did you mean "${featureId}.${event}"?`,
				);
			}
			const unsub = eventBus.on(event, handler);
			// Wrap so manual unsubscription also drops the disposable
			// (prevents unbounded growth on subscribe/unsubscribe churn).
			const dispose = () => {
				disposables.delete(dispose);
				unsub();
			};
			disposables.add(dispose);
			return dispose;
		},
		off(event: string, handler: (payload: unknown) => void) {
			assertAlive();
			eventBus.off(event, handler);
		},
	};

	// ─── State ─────────────────────────────────────────────────────────────────

	const state: SdkState = {
		register<T>(storeName: string, initialValue: T) {
			assertAlive();
			const handle = services.stateBroker.register(featureId, storeName, initialValue);
			disposables.add(() => services.stateBroker.removeStore(`${featureId}.${storeName}`));
			return handle;
		},
		get<T = unknown>(namespacedKey: string) {
			assertAlive();
			return services.stateBroker.get<T>(namespacedKey);
		},
		peek(namespacedKey: string) {
			assertAlive();
			return services.stateBroker.peek(namespacedKey);
		},
		has(namespacedKey: string) {
			assertAlive();
			return services.stateBroker.has(namespacedKey);
		},
	};

	// ─── Plugins (capabilities) ────────────────────────────────────────────────

	const exposedCapabilities = new Set<string>();
	const plugins: SdkPlugins = {
		expose(capabilityName: string, implementation: Record<string, unknown>) {
			assertAlive();
			capabilityRegistry.expose(featureId, capabilityName, implementation);
			if (!exposedCapabilities.has(capabilityName)) {
				exposedCapabilities.add(capabilityName);
				disposables.add(() => capabilityRegistry.remove(featureId, capabilityName));
			}
		},
		get<T extends Record<string, unknown> = Record<string, unknown>>(targetFeatureId: string) {
			assertAlive();
			// Asserted, not validated — the registry stores untyped objects.
			return capabilityRegistry.get(targetFeatureId) as T | null;
		},
	};

	// ─── Commands ──────────────────────────────────────────────────────────────

	const commands: SdkCommands = {
		register(definition) {
			assertAlive();
			const unregister = services.commandRegistry.register(featureId, definition);
			disposables.add(unregister);
		},
	};

	// ─── Tools (AI-runtime tool registry) ──────────────────────────────────────
	// Plugin-facing: register (own tools) + all (read-only metadata). No
	// invoke — tools are the AI adapter; plugin code calls its domain function
	// or `sdk.plugins.get<T>(...)` for cross-plugin RPC. Cross-feature tool
	// invocation is a shell concern (WebMCP bridge → `services.toolRegistry`).

	const tools: SdkTools = {
		register(definition) {
			assertAlive();
			const unregister = services.toolRegistry.register(featureId, definition);
			disposables.add(unregister);
			return () => {
				disposables.delete(unregister);
				unregister();
			};
		},
		all() {
			assertAlive();
			return services.toolRegistry.all();
		},
	};

	// ─── Deferred (throws) ─────────────────────────────────────────────────────
	// intents/dispatch have no consumer yet — see
	// docs/plugin-implementation-plan.md (Slice 4, "Deferred APIs").

	const intents: SdkIntents = {
		list() {
			throw new Error("sdk.intents requires the full plugin system — not available yet.");
		},
	};

	// ─── Navigation (shell delegate) ───────────────────────────────────────────

	const location: SdkLocation = {
		subscribe(fn: (loc: ShellLocation) => void) {
			assertAlive();
			const unsub = services.shellDelegates.navigation.subscribe(fn);
			// Wrap so manual unsubscription also drops the disposable.
			const dispose = () => {
				disposables.delete(dispose);
				unsub();
			};
			disposables.add(dispose);
			return dispose;
		},
		peek() {
			assertAlive();
			return services.shellDelegates.navigation.peek();
		},
	};

	// ─── Filesystem (shell delegate, scoped to this feature) ──────────────────

	// Bind this feature's id so the host delegate resolves every path against
	// the feature's own sandbox dir. Async wrappers so a destroyed SDK rejects
	// instead of throwing synchronously.
	const fs: SdkFs = {
		async readFile(relativePath: string) {
			assertAlive();
			return services.shellDelegates.fs.readFile(featureId, relativePath);
		},
		async writeFile(relativePath: string, content: string) {
			assertAlive();
			return services.shellDelegates.fs.writeFile(featureId, relativePath, content);
		},
		async exists(relativePath: string) {
			assertAlive();
			return services.shellDelegates.fs.exists(featureId, relativePath);
		},
		async mkdir(relativePath: string) {
			assertAlive();
			return services.shellDelegates.fs.mkdir(featureId, relativePath);
		},
		async readdir(relativePath: string) {
			assertAlive();
			return services.shellDelegates.fs.readdir(featureId, relativePath);
		},
		async remove(relativePath: string) {
			assertAlive();
			return services.shellDelegates.fs.remove(featureId, relativePath);
		},
	};

	// ─── SDK object ────────────────────────────────────────────────────────────

	const invoke = async (channel: string, args?: unknown) => {
		assertAlive();
		return services.featureRouter.invoke(featureId, channel, args);
	};

	const client = new Proxy({} as SdkClient, {
		get(_target, prop: string) {
			return (...args: unknown[]) => invoke(prop, args[0]);
		},
	});

	const sdk: SDK = {
		featureId,
		invoke,
		client,

		events,
		state,
		plugins,
		commands,

		contribute(zone: string, options: ContributionOptions) {
			assertAlive();
			const unregister = services.contributionRegistry.register(featureId, zone, options);
			// Wrap so a manual unregister also drops the disposable.
			const dispose = () => {
				disposables.delete(dispose);
				unregister();
			};
			disposables.add(dispose);
			return dispose;
		},

		notifications: services.shellDelegates.notifications,
		theme: services.shellDelegates.theme,
		auth: services.shellDelegates.auth,
		shell: services.shellDelegates.shell,
		fs,

		navigate(path: string, options?: NavigateOptions) {
			assertAlive();
			services.shellDelegates.navigation.navigate(path, options);
		},
		location,

		tools,
		intents,

		dispatch(_intent: DispatchIntent) {
			throw new Error("sdk.dispatch requires the full plugin system — not available yet.");
		},

		onDispose(fn: () => void) {
			assertAlive();
			disposables.add(fn);
		},

		destroy() {
			if (destroyed) return;
			destroyed = true;
			// Run disposables in reverse insertion order
			for (const fn of [...disposables].reverse()) {
				try {
					fn();
				} catch (error) {
					console.warn(`[SDK] Dispose callback for "${featureId}" threw:`, error);
				}
			}
			disposables.clear();
		},
	};

	return sdk;
}

/**
 * Tear down EVERYTHING registered for a feature across all SDK instances,
 * including its backend handlers in the FeatureRouter.
 *
 * Shell-owned: call this on feature/plugin unload — never from component
 * lifecycle. Destroy individual SDK instances first (sdk.destroy()) if you
 * hold references to them.
 */
export function teardownFeature(featureId: string, services: SdkFactoryServices): void {
	const { capabilityRegistry, eventBus } = services.featureRouter;
	eventBus.removeByPrefix(`${featureId}.`);
	services.stateBroker.removeByFeature(featureId);
	services.contributionRegistry.removeFeature(featureId);
	services.commandRegistry.removeFeature(featureId);
	services.toolRegistry.removeFeature(featureId);
	capabilityRegistry.removeFeature(featureId);
	services.featureRouter.destroyFeature(featureId);
}
