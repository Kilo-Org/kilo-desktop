import { createFeatureSystem, type FeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

import type {
	AuthSession,
	LocalApi,
	TelemetryTrackInput,
} from "@anaconda-agentic-desktop/contracts";
import type {
	FeatureEvent,
	FeatureFlagMap,
	FeatureRegistration,
	SdkNavigation,
	ShellDelegates,
} from "@anaconda-agentic-desktop/feature-sdk";

import { getDesktopBridge } from "./desktopBridge.js";
import { openFeaturePort } from "./featurePorts.js";
import { createInertNavigation } from "./navigation.js";
import { getColorSchemeSnapshot, subscribeColorScheme } from "./theme/color-scheme.js";

// ─── Shell delegates (bridge to LocalApi) ──────────────────────────────────

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

function createFeatureFlagsDelegate(api: LocalApi): ShellDelegates["featureFlags"] {
	// Mirror createAuthDelegate: keep a synchronous cache so useSyncExternalStore
	// can read via peek(). The host resolves the map asynchronously; seed `{}`,
	// kick off one lazy resolve, and push host changes to subscribers.
	let flags: FeatureFlagMap = {};
	const subscribers = new Set<(flags: FeatureFlagMap) => void>();
	let started = false;
	let stopOnChanged: (() => void) | undefined;

	const update = (next: FeatureFlagMap): void => {
		flags = next;
		for (const fn of subscribers) fn(next);
	};

	const start = (): void => {
		if (started) return;
		started = true;
		void api.featureFlags.getAllFlags().then(update, () => {
			// Host absent (browser mode) or resolve failed; keep the empty cache.
		});
		stopOnChanged = api.featureFlags.onChanged(update);
	};

	// Symmetric with `subscribers`: tear down the upstream subscription once the
	// last delegate subscriber leaves, allowing a later subscribe to re-start it.
	const stop = (): void => {
		started = false;
		stopOnChanged?.();
		stopOnChanged = undefined;
	};

	return {
		async getAllFlags() {
			const next = await api.featureFlags.getAllFlags();
			update(next);
			return next;
		},
		subscribe(fn) {
			subscribers.add(fn);
			fn(flags);
			start();
			return () => {
				subscribers.delete(fn);
				if (subscribers.size === 0) stop();
			};
		},
		peek: () => flags,
	};
}

export function createShellDelegates(api: LocalApi, navigation?: SdkNavigation): ShellDelegates {
	return {
		notifications: {
			show: (opts) => api.notifications.show(opts),
			setBadge: (count) => api.notifications.setBadge({ count }),
		},
		telemetry: {
			// The SDK's open `event: string` is cast to the contract's closed
			// enum; the main process validates it — this is the boundary check,
			// not the renderer.
			track: (input) =>
				api.telemetry.track({
					...input,
					event: input.event as TelemetryTrackInput["event"],
					data: input.data ?? {},
				}),
		},
		theme: {
			subscribe(fn) {
				fn(getColorSchemeSnapshot());
				return subscribeColorScheme(() => fn(getColorSchemeSnapshot()));
			},
			peek: getColorSchemeSnapshot,
		},
		auth: createAuthDelegate(api),
		featureFlags: createFeatureFlagsDelegate(api),
		shell: {
			canPickDirectories: api.shell.canPickDirectories,
			openExternal: (url) => api.shell.openExternal({ url }),
			copyText: (text) => api.shell.copyText({ text }),
			showOpenDialog: (options) => api.shell.showOpenDialog(options),
			getPathForFile: (file) => api.shell.getPathForFile(file),
		},
		// Scoped fs — the SDK binds each feature's id onto this delegate, and
		// the main process confines every path to that feature's sandbox dir
		// (`${userData}/plugins/<featureId>/fs/`). Browser mode has no filesystem;
		// its LocalApi adapter rejects.
		fs: {
			readFile: async (featureId, path) => (await api.fs.readFile({ featureId, path })).content,
			writeFile: (featureId, path, content) => api.fs.writeFile({ featureId, path, content }),
			exists: async (featureId, path) => (await api.fs.exists({ featureId, path })).exists,
			mkdir: (featureId, path) => api.fs.mkdir({ featureId, path }),
			readdir: async (featureId, path) => (await api.fs.readdir({ featureId, path })).entries,
			remove: (featureId, path) => api.fs.remove({ featureId, path }),
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
						ports: { open: openFeaturePort },
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
