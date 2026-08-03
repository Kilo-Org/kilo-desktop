import { createContext, useContext, type ReactNode } from "react";

import {
	CapabilityRegistry,
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	EventBus,
	FeatureRouter,
	qualifyFeatureEvent,
	StateBroker,
	teardownFeature,
	type FeatureRegistration,
	type FeatureEvent,
	type InvokeFallback,
	type SDK,
	type SdkClient,
	type SdkFactoryServices,
	type ShellDelegates,
} from "@anaconda-agentic-desktop/feature-sdk";

// ─── Feature system ────────────────────────────────────────────────────────

export interface FeatureSystem {
	readonly services: SdkFactoryServices;
	/**
	 * Get the shared SDK instance for a feature. Instances are cached per
	 * feature and live until teardownFeature() — they are NOT tied to
	 * component lifecycles.
	 */
	getSdk(featureId: string): SDK;
	/** Shell-owned full teardown of a feature (plugin unload). */
	teardownFeature(featureId: string): void;
}

export interface CreateFeatureSystemOptions {
	/** Host-provided shell services: notifications, theme, shell, fs. */
	shellDelegates: ShellDelegates;
	/**
	 * Transport for channels that have no in-process handler. In Electron the
	 * host routes this through its generic `feature:invoke` IPC bridge. When
	 * provided, feature backends are assumed to live out of process and
	 * `features` are NOT booted here.
	 */
	invokeFallback?: InvokeFallback;
	/**
	 * Optional Electron event transport. Outbound events have already been
	 * namespace-stamped and cloneability-checked by the SDK; inbound events
	 * are delivered directly to the local bus so they are not echoed back.
	 */
	eventTransport?: {
		emit(event: FeatureEvent): void;
		onEvent(handler: (event: FeatureEvent) => void): () => void;
	};
	/**
	 * Features to boot in-process when no `invokeFallback` is provided
	 * (browser mode — no main process available). Only `browserRegister`
	 * boots; features without one are skipped with a warning. There is
	 * deliberately no fallback to `mainRegister`, which may use Node APIs.
	 */
	features?: readonly FeatureRegistration[];
}

/**
 * Create the renderer-side feature system. The host calls this once at app
 * startup and passes the result to <SdkProvider>.
 */
export function createFeatureSystem(options: CreateFeatureSystemOptions): FeatureSystem {
	const { invokeFallback, features = [] } = options;
	const eventTransport = options.eventTransport;

	const eventBus = new EventBus();
	const capabilityRegistry = new CapabilityRegistry();
	const featureRouter = new FeatureRouter({
		...(invokeFallback ? { fallback: invokeFallback } : {}),
		eventBus,
		capabilityRegistry,
	});

	const services: SdkFactoryServices = {
		eventBus,
		...(eventTransport ? { emitEvent: (event: FeatureEvent) => eventTransport.emit(event) } : {}),
		stateBroker: new StateBroker(),
		capabilityRegistry,
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter,
		shellDelegates: options.shellDelegates,
	};

	eventTransport?.onEvent((event) => {
		eventBus.emit(qualifyFeatureEvent(event.featureId, event.name), event.payload);
	});

	// Browser mode: boot feature backends in-process (no main process available).
	// Only browserRegister boots here — deliberately no fallback to mainRegister,
	// which may use Node APIs. Node-free features opt in explicitly with
	// `browserRegister: mainRegister`.
	if (!invokeFallback) {
		for (const feature of features) {
			if (!feature.browserRegister) {
				console.warn(
					`[FeatureSystem] Feature "${feature.id}" has no browserRegister — skipped in browser mode.`,
				);
				continue;
			}
			const mainSdk = featureRouter.createMainSdk(feature.id);
			try {
				feature.browserRegister(mainSdk);
			} catch (error) {
				console.error(`[FeatureSystem] Boot failed for "${feature.id}":`, error);
				featureRouter.destroyFeature(feature.id);
			}
		}
	}

	const sdkCache = new Map<string, SDK>();

	return {
		services,
		getSdk(featureId: string): SDK {
			let sdk = sdkCache.get(featureId);
			if (!sdk) {
				sdk = createSdk(featureId, services);
				sdkCache.set(featureId, sdk);
			}
			return sdk;
		},
		teardownFeature(featureId: string): void {
			sdkCache.get(featureId)?.destroy();
			sdkCache.delete(featureId);
			teardownFeature(featureId, services);
		},
	};
}

// ─── React context + hooks ─────────────────────────────────────────────────

const FeatureSystemContext = createContext<FeatureSystem | null>(null);

export function SdkProvider({
	system,
	children,
}: {
	readonly system: FeatureSystem;
	readonly children: ReactNode;
}) {
	return <FeatureSystemContext.Provider value={system}>{children}</FeatureSystemContext.Provider>;
}

/** Access the feature system (registries, teardown) — for shell UI code. */
export function useFeatureSystem(): FeatureSystem {
	const system = useContext(FeatureSystemContext);
	if (!system) {
		throw new Error("useFeatureSystem must be used within <SdkProvider>.");
	}
	return system;
}

/**
 * Get the SDK instance for a feature. Pass a service type generic to get
 * a typed `client` property with method-style access to channels.
 *
 * @example
 * const { client } = useSdk<TodoService>("todos");
 * const todo = await client.add({ title: "Buy milk" }); // typed as Todo
 *
 * The instance is shared by every component of the feature and is NOT
 * destroyed on unmount; teardown is shell-owned (FeatureSystem.teardownFeature).
 */
export function useSdk<T extends SdkClient = SdkClient>(featureId: string): SDK<T> {
	return useFeatureSystem().getSdk(featureId) as SDK<T>;
}
