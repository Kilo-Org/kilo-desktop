import type { AnyRouter } from "@tanstack/react-router";

import {
	KernelApp,
	type Contribution,
	type DomainProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import { DeepLink, Navigation } from "../contracts";

type SearchParams = Readonly<Record<string, string>>;

function stringSearch(search: unknown): Record<string, string> {
	if (typeof search !== "object" || search === null) return {};
	return Object.fromEntries(
		Object.entries(search).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/** Publishes the main window's location and lets any plugin move it. */
export function provideNavigation(sdk: PluginSdk, router: AnyRouter): void {
	const current = () => ({
		path: router.state.location.pathname,
		search: stringSearch(router.state.location.search),
	});
	const go = (path: string, search: SearchParams = {}) =>
		router.navigate({ to: path, search: { ...search } } as never);
	const navigation: DomainProvider<typeof Navigation> = sdk.domains.provide(Navigation, {
		initialState: current(),
		methods: {
			navigate: async ({ path, search }) => void (await go(path, search)),
			openSettings: async ({ section }) =>
				void (await go(section ? `/settings/${section}` : "/settings")),
			goHome: async () => void (await go("/")),
		},
	});
	sdk.onDispose(router.subscribe("onResolved", () => navigation.setState(current())));
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

/** Sends the launch URL and URLs opened later to the routes plugins contribute. */
export function routeDeepLinks(sdk: PluginSdk): void {
	const open = (url: string) => {
		const target = resolveDeepLink(url, sdk.extensions.list(DeepLink));
		if (!target) {
			sdk.logger.warn(`No deep link handles "${url}".`);
			return;
		}
		void sdk.domains.get(Navigation)?.methods.navigate(target);
	};
	const app = sdk.domains.get(KernelApp);
	if (!app) return;
	void app.methods
		.takeLaunchUrl(undefined)
		.then((url) => {
			if (url) open(url);
		})
		.catch(() => {});
	app.on("url-opened", ({ url }) => open(url));
}
