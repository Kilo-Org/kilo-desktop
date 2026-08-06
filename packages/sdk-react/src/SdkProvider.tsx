import { createContext, useContext, type ReactNode } from "react";

import {
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	FeatureRouter,
	qualifyFeatureEvent,
	StateBroker,
	teardownFeature,
	ToolRegistry,
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
	/** Tear down the complete runtime, including its host transport subscription. */
	dispose(): void;
}

/** Complete host transport for Electron mode. Omit it in browser mode. */
export interface FeatureSystemTransport {
	readonly invoke: InvokeFallback;
	readonly events: {
		emit(event: FeatureEvent): void;
		on(handler: (event: FeatureEvent) => void): () => void;
	};
}

export interface CreateFeatureSystemOptions {
	/** Host-provided shell services: notifications, theme, shell, fs. */
	shellDelegates: ShellDelegates;
	/**
	 * Complete Electron transport. When present, feature backends live out of
	 * process and `features` are not booted here. Browser mode omits this and
	 * shares the FeatureRouter's in-process event bus and capabilities.
	 */
	transport?: FeatureSystemTransport;
	/**
	 * Features to boot in-process when no transport is provided
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
	const { features = [], transport } = options;

	const featureRouter = new FeatureRouter(transport ? { fallback: transport.invoke } : undefined);

	const services: SdkFactoryServices = {
		...(transport ? { emitEvent: (event: FeatureEvent) => transport.events.emit(event) } : {}),
		stateBroker: new StateBroker(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		toolRegistry: new ToolRegistry(),
		featureRouter,
		shellDelegates: options.shellDelegates,
	};

	const detachTransport = transport?.events.on((event) => {
		featureRouter.eventBus.emit(qualifyFeatureEvent(event.featureId, event.name), event.payload);
	});
	const bootedFeatureIds = new Set<string>();
	// Features whose browserRegister threw and whose FeatureRouter entry was torn
	// down. In browser mode their `sdk.invoke` path is dead, so `webRegister`
	// would only register tools whose handlers can never succeed — skip them.
	const failedFeatureIds = new Set<string>();

	// Browser mode: boot feature backends in-process (no main process available).
	// Only browserRegister boots here — deliberately no fallback to mainRegister,
	// which may use Node APIs. Node-free features opt in explicitly with
	// `browserRegister: mainRegister`.
	if (!transport) {
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
				bootedFeatureIds.add(feature.id);
			} catch (error) {
				console.error(`[FeatureSystem] Boot failed for "${feature.id}":`, error);
				featureRouter.destroyFeature(feature.id);
				failedFeatureIds.add(feature.id);
			}
		}
	}

	const sdkCache = new Map<string, SDK>();
	let disposed = false;

	function assertActive(): void {
		if (disposed) throw new Error("FeatureSystem has been disposed.");
	}

	function getOrCreateSdk(featureId: string): SDK {
		let sdk = sdkCache.get(featureId);
		if (!sdk) {
			sdk = createSdk(featureId, services);
			sdkCache.set(featureId, sdk);
		}
		return sdk;
	}

	// Renderer-side setup for every feature, run in BOTH modes (unlike
	// browserRegister which only runs in browser mode). This is where a plugin
	// registers `sdk.tools` and other renderer-only concerns — see FeatureRegistration
	// `webRegister` and issue #74. A throwing webRegister must not break the whole
	// app (a bad plugin isolates itself), so we log and continue.
	for (const feature of features) {
		if (!feature.webRegister) continue;
		if (failedFeatureIds.has(feature.id)) {
			// browserRegister failed for this feature; its backend is gone. Tools
			// registered here would only produce failing invocations. Skip.
			console.warn(
				`[FeatureSystem] Skipping webRegister for "${feature.id}" — browserRegister failed.`,
			);
			continue;
		}
		try {
			feature.webRegister(getOrCreateSdk(feature.id));
		} catch (error) {
			console.error(`[FeatureSystem] webRegister failed for "${feature.id}":`, error);
		}
	}

	function teardown(featureId: string): void {
		sdkCache.get(featureId)?.destroy();
		sdkCache.delete(featureId);
		bootedFeatureIds.delete(featureId);
		teardownFeature(featureId, services);
	}

	return {
		services,
		getSdk(featureId: string): SDK {
			assertActive();
			return getOrCreateSdk(featureId);
		},
		teardownFeature(featureId: string): void {
			assertActive();
			teardown(featureId);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			detachTransport?.();
			const featureIds = new Set([...bootedFeatureIds, ...sdkCache.keys()]);
			for (const featureId of featureIds) teardown(featureId);
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
