import { createContext, useContext, type ReactNode } from "react";

import {
	CapabilityRegistry,
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	EventBus,
	FeatureRouter,
	StateBroker,
	teardownFeature,
	type FeatureRegistration,
	type SDK,
	type SdkFactoryServices,
	type ShellDelegates,
} from "@anaconda-agentic-desktop/feature-sdk";

import type { DesktopApi, LocalApi } from "@anaconda-agentic-desktop/contracts";

// ─── Bridge detection ──────────────────────────────────────────────────────

function getDesktopBridge(): DesktopApi | undefined {
	return (globalThis as { desktopApi?: DesktopApi }).desktopApi;
}

// ─── Shell delegates (bridge to LocalApi) ──────────────────────────────────

function undeliveredNotifications(): ShellDelegates["notifications"] {
	// Not wired yet: expected capability absence, so report it in the result
	// envelope instead of throwing (features detect the capability, not the
	// platform). Warn once so the gap stays visible during development.
	let warned = false;
	const undelivered = (method: string) => {
		if (!warned) {
			warned = true;
			console.warn(
				`[FeatureSystem] ${method}: notifications are not wired yet — reporting delivered: false.`,
			);
		}
		return { delivered: false, reason: "sdk.notifications is not yet wired to a shell service." };
	};
	return {
		show: () => undelivered("sdk.notifications.show"),
		setBadge: () => undelivered("sdk.notifications.setBadge"),
	};
}

function peekEffectiveTheme(): "dark" | "light" {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function createShellDelegates(api: LocalApi): ShellDelegates {
	return {
		notifications: undeliveredNotifications(),
		theme: {
			subscribe(fn) {
				// Observable contract: fire synchronously with the current value,
				// then push updates. No async initial read — avoids racing
				// onChanged events against a stale get() result.
				fn(peekEffectiveTheme());
				return api.theme.onChanged((state) => {
					fn(state.shouldUseDarkColors ? "dark" : "light");
				});
			},
			peek: peekEffectiveTheme,
		},
		shell: {
			openExternal: (url) => api.shell.openExternal({ url }),
			copyText: (text) => api.shell.copyText({ text }),
		},
		fs: {
			readFile: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			writeFile: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			exists: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			mkdir: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			readdir: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			remove: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
		},
	};
}

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

/**
 * Create the renderer-side feature system. Call once at app startup and pass
 * the result to <SdkProvider>.
 *
 * In Electron mode: sdk.invoke falls back to the generic feature:invoke IPC
 * channel (handlers live in the main process; `features` is not booted here).
 * In browser mode: features are booted in-process via browserRegister();
 * features without one are skipped with a warning.
 */
export function createFeatureSystem(
	api: LocalApi,
	features: readonly FeatureRegistration[] = [],
): FeatureSystem {
	const bridge = getDesktopBridge();

	const featureRouter = new FeatureRouter(
		bridge
			? {
					fallback: async (featureId, channel, args) => {
						const result = await bridge.invoke("feature:invoke", { featureId, channel, args });
						if (!result.ok) {
							throw new Error(result.error.message);
						}
						return result.value;
					},
				}
			: {},
	);

	const services: SdkFactoryServices = {
		eventBus: new EventBus(),
		stateBroker: new StateBroker(),
		capabilityRegistry: new CapabilityRegistry(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter,
		shellDelegates: createShellDelegates(api),
	};

	// Browser mode: boot feature backends in-process (no main process available).
	// Only browserRegister boots here — deliberately no fallback to mainRegister,
	// which may use Node APIs. Node-free features opt in explicitly with
	// `browserRegister: mainRegister`.
	if (!bridge) {
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
 * Get the shared SDK instance for a feature.
 * Call sites: `const sdk = useSdk("todos")` — stable across all migration stages.
 * The instance is shared by every component of the feature and is NOT
 * destroyed on unmount; teardown is shell-owned (FeatureSystem.teardownFeature).
 */
export function useSdk(featureId: string): SDK {
	return useFeatureSystem().getSdk(featureId);
}
