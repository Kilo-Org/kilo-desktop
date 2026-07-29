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
 * All registrations are tracked for cleanup on destroy().
 */
export function createSdk(featureId: string, services: SdkFactoryServices): SDK {
	const disposables: Array<() => void> = [];
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
			const unsub = services.eventBus.on(event, handler);
			disposables.push(unsub);
			return unsub;
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
			return services.stateBroker.register(featureId, storeName, initialValue);
		},
		get<T = unknown>(namespacedKey: string) {
			assertAlive();
			return services.stateBroker.get<T>(namespacedKey);
		},
		peek(namespacedKey: string) {
			assertAlive();
			return services.stateBroker.peek(namespacedKey);
		},
	};

	// ─── Plugins (capabilities) ────────────────────────────────────────────────

	let capabilityCleanupRegistered = false;
	const plugins: SdkPlugins = {
		expose(capabilityName: string, implementation: Record<string, unknown>) {
			assertAlive();
			services.capabilityRegistry.expose(featureId, capabilityName, implementation);
			if (!capabilityCleanupRegistered) {
				capabilityCleanupRegistered = true;
				disposables.push(() => services.capabilityRegistry.removeFeature(featureId));
			}
		},
		get(targetFeatureId: string) {
			assertAlive();
			return services.capabilityRegistry.get(targetFeatureId);
		},
	};

	// ─── Commands ──────────────────────────────────────────────────────────────

	const commands: SdkCommands = {
		register(definition) {
			assertAlive();
			services.commandRegistry.register(featureId, definition);
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
			services.contributionRegistry.register(featureId, zone, options);
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
			disposables.push(fn);
		},

		destroy() {
			if (destroyed) return;
			destroyed = true;
			// Run disposables in reverse order
			for (const fn of disposables.reverse()) {
				try {
					fn();
				} catch (error) {
					console.warn(`[SDK] Dispose callback for "${featureId}" threw:`, error);
				}
			}
			services.eventBus.removeByPrefix(`${featureId}.`);
			services.stateBroker.removeByFeature(featureId);
			services.contributionRegistry.removeFeature(featureId);
			services.commandRegistry.removeFeature(featureId);
			services.capabilityRegistry.removeFeature(featureId);
			services.featureRouter.destroyFeature(featureId);
		},
	};

	return sdk;
}
