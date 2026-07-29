import type {
	ContributionOptions,
	DispatchIntent,
	NavigateIntent,
	SDK,
	SdkCommands,
	SdkEvents,
	SdkFs,
	SdkIntents,
	SdkNotifications,
	SdkPlugins,
	SdkShell,
	SdkState,
	SdkTheme,
	SdkTools,
} from "../types/sdk.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { CommandRegistry } from "./command-registry.js";
import type { ContributionRegistry } from "./contribution-registry.js";
import type { EventBus } from "./event-bus.js";
import type { FeatureRouter } from "./feature-router.js";
import type { StateBroker } from "./state-broker.js";

export interface ShellDelegates {
	notifications: SdkNotifications;
	theme: SdkTheme;
	shell: SdkShell;
	fs: SdkFs;
}

export interface SdkFactoryServices {
	eventBus: EventBus;
	stateBroker: StateBroker;
	capabilityRegistry: CapabilityRegistry;
	contributionRegistry: ContributionRegistry;
	commandRegistry: CommandRegistry;
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
			services.eventBus.emit(`${featureId}.${event}`, payload);
		},
		on(event: string, handler: (payload: unknown) => void) {
			assertAlive();
			if (!event.includes(".")) {
				console.warn(
					`[SDK] events.on("${event}") has no feature namespace — events are always ` +
						`"featureId.eventName". Did you mean "${featureId}.${event}"?`,
				);
			}
			const unsub = services.eventBus.on(event, handler);
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
			services.eventBus.off(event, handler);
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
			services.capabilityRegistry.expose(featureId, capabilityName, implementation);
			if (!exposedCapabilities.has(capabilityName)) {
				exposedCapabilities.add(capabilityName);
				disposables.add(() => services.capabilityRegistry.remove(featureId, capabilityName));
			}
		},
		get<T extends Record<string, unknown> = Record<string, unknown>>(targetFeatureId: string) {
			assertAlive();
			// Asserted, not validated — the registry stores untyped objects.
			return services.capabilityRegistry.get(targetFeatureId) as T | null;
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

	// ─── Deferred (throws) ─────────────────────────────────────────────────────

	const tools: SdkTools = {
		register() {
			throw new Error("sdk.tools requires the full plugin system — not available yet.");
		},
		invoke() {
			throw new Error("sdk.tools requires the full plugin system — not available yet.");
		},
		all() {
			throw new Error("sdk.tools requires the full plugin system — not available yet.");
		},
	};

	const intents: SdkIntents = {
		list() {
			throw new Error("sdk.intents requires the full plugin system — not available yet.");
		},
	};

	// ─── SDK object ────────────────────────────────────────────────────────────

	const sdk: SDK = {
		featureId,

		async invoke(channel: string, args?: unknown) {
			assertAlive();
			return services.featureRouter.invoke(featureId, channel, args);
		},

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
		shell: services.shellDelegates.shell,
		fs: services.shellDelegates.fs,

		tools,
		intents,

		navigate(_intent: NavigateIntent) {
			throw new Error("sdk.navigate requires the full plugin system — not available yet.");
		},

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
	services.eventBus.removeByPrefix(`${featureId}.`);
	services.stateBroker.removeByFeature(featureId);
	services.contributionRegistry.removeFeature(featureId);
	services.commandRegistry.removeFeature(featureId);
	services.capabilityRegistry.removeFeature(featureId);
	services.featureRouter.destroyFeature(featureId);
}
