import { createFeatureSystem, type FeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

import type { LocalApi } from "@anaconda-agentic-desktop/contracts";
import type { FeatureRegistration, ShellDelegates } from "@anaconda-agentic-desktop/feature-sdk";

import { getDesktopBridge } from "./desktopBridge.js";

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

export function createShellDelegates(api: LocalApi): ShellDelegates {
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

// ─── App feature system ────────────────────────────────────────────────────

/**
 * Create the app's renderer-side feature system. Call once at startup and
 * pass the result to <SdkProvider>.
 *
 * In Electron mode: sdk.invoke falls back to the generic feature:invoke IPC
 * channel (handlers live in the main process; `features` is not booted here).
 * In browser mode: features are booted in-process via browserRegister();
 * features without one are skipped with a warning.
 */
export function createAppFeatureSystem(
	api: LocalApi,
	features: readonly FeatureRegistration[] = [],
): FeatureSystem {
	const bridge = getDesktopBridge();

	return createFeatureSystem({
		shellDelegates: createShellDelegates(api),
		features,
		...(bridge
			? {
					invokeFallback: async (featureId: string, channel: string, args?: unknown) => {
						const result = await bridge.invoke("feature:invoke", { featureId, channel, args });
						if (!result.ok) {
							throw new Error(result.error.message);
						}
						return result.value;
					},
				}
			: {}),
	});
}
