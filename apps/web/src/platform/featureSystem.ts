import { createFeatureSystem, type FeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

import type { AuthSession, LocalApi } from "@anaconda-agentic-desktop/contracts";
import type {
	FeatureEvent,
	FeatureRegistration,
	SdkNavigation,
	ShellDelegates,
} from "@anaconda-agentic-desktop/feature-sdk";

import { getDesktopBridge } from "./desktopBridge.js";
import { createInertNavigation } from "./navigation.js";
import { getColorSchemeSnapshot, subscribeColorScheme } from "./theme/color-scheme.js";

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

function createAuthDelegate(api: LocalApi): ShellDelegates["auth"] {
	// Module-scoped-per-delegate cache: unlike theme (a synchronous DOM read),
	// the session resolves asynchronously. Seed anonymous, kick off one lazy
	// resolve, and push the result to subscribers when it lands.
	let session: AuthSession = { status: "anonymous" };
	const subscribers = new Set<(session: AuthSession) => void>();
	let started = false;
	let stopOnChanged: (() => void) | undefined;

	const update = (next: AuthSession): void => {
		session = next;
		for (const fn of subscribers) fn(next);
	};

	const start = (): void => {
		if (started) return;
		started = true;
		void api.auth.getSession().then(update, () => {
			// Adapter already maps failures to an error session; ignore rejections.
		});
		stopOnChanged = api.auth.onChanged(update);
	};

	// Symmetric with `subscribers`: tear down the upstream subscription once
	// the last delegate subscriber unsubscribes, and allow a later subscribe
	// to re-start it rather than leaking it for the process lifetime.
	const stop = (): void => {
		started = false;
		stopOnChanged?.();
		stopOnChanged = undefined;
	};

	return {
		subscribe(fn) {
			subscribers.add(fn);
			fn(session);
			start();
			return () => {
				subscribers.delete(fn);
				if (subscribers.size === 0) stop();
			};
		},
		peek: () => session,
		async getSession() {
			const next = await api.auth.getSession();
			update(next);
			return next;
		},
		async refresh() {
			const next = await api.auth.refresh();
			update(next);
			return next;
		},
		async login() {
			const next = await api.auth.login();
			update(next);
			return next;
		},
		async logout() {
			const next = await api.auth.logout();
			update(next);
			return next;
		},
	};
}

export function createShellDelegates(api: LocalApi, navigation?: SdkNavigation): ShellDelegates {
	return {
		notifications: undeliveredNotifications(),
		theme: {
			subscribe(fn) {
				fn(getColorSchemeSnapshot());
				return subscribeColorScheme(() => fn(getColorSchemeSnapshot()));
			},
			peek: getColorSchemeSnapshot,
		},
		auth: createAuthDelegate(api),
		shell: {
			canPickDirectories: api.shell.canPickDirectories,
			openExternal: (url) => api.shell.openExternal({ url }),
			copyText: (text) => api.shell.copyText({ text }),
			showOpenDialog: (options) => api.shell.showOpenDialog(options),
			getPathForFile: (file) => api.shell.getPathForFile(file),
		},
		fs: {
			readFile: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			writeFile: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			exists: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			mkdir: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			readdir: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
			remove: () => Promise.reject(new Error("sdk.fs is not yet wired to a shell service.")),
		},
		navigation: navigation ?? createInertNavigation(),
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
 *
 * `navigation` is the router-backed delegate from `createRouterNavigation`;
 * when omitted (tests, tooling) navigation is an inert warn-once no-op.
 */
export function createAppFeatureSystem(
	api: LocalApi,
	features: readonly FeatureRegistration[] = [],
	navigation?: SdkNavigation,
): FeatureSystem {
	const bridge = getDesktopBridge();

	return createFeatureSystem({
		shellDelegates: createShellDelegates(api, navigation),
		features,
		...(bridge
			? {
					transport: {
						invoke: async (featureId: string, channel: string, args?: unknown) => {
							const result = await bridge.invoke("feature:invoke", { featureId, channel, args });
							if (!result.ok) {
								throw new Error(result.error.message);
							}
							return result.value;
						},
						events: {
							emit: (event: FeatureEvent) => bridge.send("feature:event", event),
							on: (handler: (event: FeatureEvent) => void) => bridge.on("feature:event", handler),
						},
					},
				}
			: {}),
	});
}
