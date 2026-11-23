import type { AnyRouter } from "@tanstack/react-router";

import { KernelApp, type Contribution, type PluginSdk } from "@kilo-desktop/kernel";

import { DeepLink, Dialog, Navigation, Takeover, type WindowLocation } from "../../contracts";
import type { ShellUiState } from "./ui-state";

type SearchParams = Readonly<Record<string, string>>;

export function stringSearch(search: unknown): Record<string, string> {
	if (typeof search !== "object" || search === null) return {};
	return Object.fromEntries(
		Object.entries(search).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/** Moves this window's router; the window's own commands and deep links use it directly. */
export type Go = (path: string, search?: SearchParams) => Promise<void>;

export function routerGo(router: AnyRouter): Go {
	return async (path, search = {}) => {
		await router.navigate({ to: path, search: { ...search } } as never);
	};
}

/**
 * Joins this window to `kilo.shell/navigation` in main: reports where the
 * router is whenever it settles, and applies the requests main addresses to
 * this window (navigating, opening a dialog, showing or closing a take-over).
 * Without main's navigation (browser mode) the window still navigates on its
 * own.
 */
export function connectWindowNavigation(sdk: PluginSdk, router: AnyRouter, ui: ShellUiState): void {
	const windowId = sdk.windowId;
	const go = routerGo(router);
	const location = (): WindowLocation => ({
		path: router.state.location.pathname,
		search: stringSearch(router.state.location.search),
	});

	let stops: (() => void)[] = [];
	const stop = () => {
		for (const unsubscribe of stops) unsubscribe();
		stops = [];
	};
	sdk.domainObjects.track(Navigation, {
		added(navigation) {
			const report = () =>
				void navigation.methods.reportLocation(location()).catch((error: unknown) => {
					sdk.logger.warn("Could not report this window's location", error);
				});
			report();
			stops = [
				router.subscribe("onResolved", report),
				navigation.on("navigate-requested", (request) => {
					if (request.windowId === windowId) void go(request.path, request.search);
				}),
				navigation.on("dialog-requested", (request) => {
					if (request.windowId !== windowId) return;
					if (!sdk.extensions.list(Dialog).some((dialog) => dialog.key === request.dialog)) {
						sdk.logger.warn(`No dialog "${request.dialog}" to open.`);
						return;
					}
					ui.openDialog(request.dialog, request.input);
				}),
				navigation.on("takeover-requested", (request) => {
					if (request.windowId !== windowId) return;
					if (!sdk.extensions.list(Takeover).some((each) => each.key === request.takeover)) {
						sdk.logger.warn(`No take-over "${request.takeover}" to show.`);
						return;
					}
					ui.openTakeover(request.takeover, request.input);
				}),
				navigation.on("takeover-close-requested", (request) => {
					if (request.windowId === windowId) ui.closeTakeover();
				}),
			];
		},
		removed: stop,
	});
	sdk.onDispose(stop);
}

export interface DeepLinkTarget {
	readonly path: string;
	readonly search: Record<string, string>;
}

/** Resolves `<scheme>://<host>?…` against the deep-link contributions; null when nothing matches. */
export function resolveDeepLink(
	url: string,
	links: readonly Contribution<typeof DeepLink>[],
): DeepLinkTarget | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const host = parsed.hostname || parsed.pathname.replace(/^\/+/, "").split("/")[0];
	const link = links.find((candidate) => candidate.metadata.host === host);
	if (!link) return null;
	const search: Record<string, string> = {};
	for (const name of link.metadata.query) {
		const value = parsed.searchParams.get(name);
		if (value !== null) search[name] = value;
	}
	const path = parsed.hostname ? parsed.pathname : parsed.pathname.replace(/^\/*[^/]*/, "");
	const segment = path.split("/").find(Boolean);
	if (link.metadata.pathParam && segment) {
		search[link.metadata.pathParam] = decodeURIComponent(segment);
	}
	return { path: link.metadata.path, search };
}

/** Sends the launch URL and URLs opened later to the pages plugins contribute. */
export function routeDeepLinks(sdk: PluginSdk, go: Go): void {
	const open = (url: string) => {
		const target = resolveDeepLink(url, sdk.extensions.list(DeepLink));
		if (!target) {
			sdk.logger.warn(`No deep link handles "${url}".`);
			return;
		}
		void go(target.path, target.search);
	};
	const app = sdk.domainObjects.get(KernelApp);
	if (!app) return;
	void app.methods
		.takeLaunchUrl(undefined)
		.then((url) => {
			if (url) open(url);
		})
		.catch(() => {});
	app.on("url-opened", ({ url }) => open(url));
}
