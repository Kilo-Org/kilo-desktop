import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
	CapabilityRegistry,
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	EventBus,
	FeatureRouter,
	StateBroker,
	type FeatureRegistration,
	type SDK,
	type SdkFactoryServices,
	type ShellDelegates,
} from "@anaconda-agentic-desktop/feature-sdk";

import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

// ─── Shared service singletons ─────────────────────────────────────────────

const eventBus = new EventBus();
const stateBroker = new StateBroker();
const capabilityRegistry = new CapabilityRegistry();
const contributionRegistry = new ContributionRegistry();
const commandRegistry = new CommandRegistry();
const featureRouter = new FeatureRouter();

export { contributionRegistry, commandRegistry };

// ─── Shell delegates (bridge to LocalApi) ──────────────────────────────────

function createShellDelegates(api: LocalApi): ShellDelegates {
	return {
		notifications: {
			show(opts) {
				// TODO: wire to a notification service when one exists
				console.info(`[Notification] ${opts.type}: ${opts.title} — ${opts.message}`);
			},
			setBadge(_count) {
				// TODO: wire to sidebar badge state
			},
		},
		theme: {
			subscribe(fn) {
				// Bridge LocalApi theme subscription to observable contract
				let current: "dark" | "light" = "light";
				void api.theme.get().then((state) => {
					current = state.shouldUseDarkColors ? "dark" : "light";
					fn(current);
				});
				const unsub = api.theme.onChanged((state) => {
					current = state.shouldUseDarkColors ? "dark" : "light";
					fn(current);
				});
				return unsub;
			},
			peek() {
				return document.documentElement.classList.contains("dark") ? "dark" : "light";
			},
			getEffective() {
				return document.documentElement.classList.contains("dark") ? "dark" : "light";
			},
		},
		shell: {
			openExternal: (url) => api.shell.openExternal({ url }),
			copyText: (text) => api.shell.copyText({ text }),
		},
		fs: {
			// TODO: wire when feature:invoke supports fs channels from main,
			// or when a dedicated fs service is added.
			readFile: () => Promise.reject(new Error("sdk.fs not yet wired")),
			writeFile: () => Promise.reject(new Error("sdk.fs not yet wired")),
			exists: () => Promise.reject(new Error("sdk.fs not yet wired")),
			mkdir: () => Promise.reject(new Error("sdk.fs not yet wired")),
			readdir: () => Promise.reject(new Error("sdk.fs not yet wired")),
			remove: () => Promise.reject(new Error("sdk.fs not yet wired")),
		},
	};
}

// ─── Invoke adapter ────────────────────────────────────────────────────────

/**
 * Create the invoke adapter for the FeatureRouter.
 * In Electron: routes through preload bridge → main process.
 * In browser: routes directly to in-process handlers.
 */
function createInvokeAdapter(
	_api: LocalApi,
): (featureId: string, channel: string, args?: unknown) => Promise<unknown> {
	const bridge = (
		globalThis as {
			desktopApi?: {
				invoke: (
					ch: string,
					input: unknown,
				) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>;
			};
		}
	).desktopApi;

	if (bridge) {
		// Electron mode: route through the generic feature:invoke IPC channel
		return async (featureId, channel, args) => {
			const result = await bridge.invoke("feature:invoke", { featureId, channel, args });
			if (!result.ok) {
				throw new Error(
					result.error?.message ?? `feature:invoke failed for ${featureId}:${channel}`,
				);
			}
			return result.value;
		};
	}

	// Browser mode: route directly to in-process handlers
	return (featureId, channel, args) => featureRouter.invoke(featureId, channel, args);
}

// ─── Boot features (renderer-side) ─────────────────────────────────────────

let servicesInstance: SdkFactoryServices | null = null;

/**
 * Initialize the feature system. Must be called once at app startup.
 * Boots all feature mainRegister() in browser mode (in Electron, main does this).
 */
export function initializeFeatureSystem(
	api: LocalApi,
	features: readonly FeatureRegistration[],
): void {
	const shellDelegates = createShellDelegates(api);
	const invokeAdapter = createInvokeAdapter(api);

	// Patch the featureRouter's invoke to use the adapter
	// (in Electron mode, sdk.invoke goes through IPC; in browser mode, goes direct)
	const originalInvoke = featureRouter.invoke.bind(featureRouter);
	featureRouter.invoke = async (featureId: string, channel: string, args?: unknown) => {
		// If we have a local handler (browser mode), use it directly
		if (featureRouter.has(featureId, channel)) {
			return originalInvoke(featureId, channel, args);
		}
		// Otherwise use the adapter (Electron mode → IPC, or error)
		return invokeAdapter(featureId, channel, args);
	};

	servicesInstance = {
		eventBus,
		stateBroker,
		capabilityRegistry,
		contributionRegistry,
		commandRegistry,
		featureRouter,
		shellDelegates,
	};

	// In browser mode, boot features' mainRegister locally (no main process available)
	const bridge = (globalThis as { desktopApi?: unknown }).desktopApi;
	if (!bridge) {
		for (const feature of features) {
			const mainSdk = featureRouter.createMainSdk(feature.id);
			try {
				feature.mainRegister(mainSdk);
			} catch (error) {
				console.error(`[FeatureSystem] mainRegister failed for "${feature.id}":`, error);
			}
		}
	}
}

// ─── React context + hook ──────────────────────────────────────────────────

const SdkContext = createContext<SdkFactoryServices | null>(null);

export function SdkProvider({ children }: { children: ReactNode }) {
	if (!servicesInstance) {
		throw new Error("SdkProvider requires initializeFeatureSystem() to be called first.");
	}
	return <SdkContext.Provider value={servicesInstance}>{children}</SdkContext.Provider>;
}

/**
 * Get a scoped SDK instance for a feature.
 * Call sites: `const sdk = useSdk("todos")` — stable across all migration stages.
 */
export function useSdk(featureId: string): SDK {
	const services = useContext(SdkContext);
	if (!services) {
		throw new Error(
			"useSdk must be used within <SdkProvider>. Call initializeFeatureSystem() at app boot.",
		);
	}
	// Memoize by featureId so the same SDK instance is reused across renders
	// eslint-disable-next-line react-hooks/exhaustive-deps
	return useMemo(() => createSdk(featureId, services), [featureId, services]);
}
