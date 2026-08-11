import { PLUGIN_ROUTE_NAMESPACE } from "@anaconda-agentic-desktop/feature-sdk";
import type { ComponentType } from "react";

import { BUILT_IN_SIDECARS, type PluginSidecarProps } from "@/features/built-in-sidecars";
import { PLUGIN_PAGES, findPluginPage, type PluginPage } from "@/features/plugin-pages";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";

type PluginPageViewProps = {
	/** The catch-all route's splat, i.e. the path after `/plugins/`. */
	splat: string | undefined;
	/** Parsed search params of the current location. */
	search: Record<string, unknown>;
	/** Injectable for tests; defaults to the bundled plugin pages. */
	pages?: readonly PluginPage[];
	/** Injectable for tests; defaults to Electron bridge detection. */
	desktopAvailable?: boolean;
	/** Injectable for tests; defaults to the host's built-in companion surfaces. */
	sidecars?: Readonly<Record<string, ComponentType<PluginSidecarProps>>>;
};

/**
 * Resolves a plugin page from the manifest registry at render time — the
 * sanctioned host-owned route strategy (Decision #19): the shell's catch-all
 * route (routes/plugins/$.tsx) delegates here, so plugin routes exist under
 * the `/plugins/*` namespace without touching the file-based route tree and
 * plugins never see the router.
 */
export function PluginPageView({
	splat,
	search,
	pages = PLUGIN_PAGES,
	desktopAvailable = isDesktopBridgeAvailable(),
	sidecars = BUILT_IN_SIDECARS,
}: PluginPageViewProps) {
	const path = `${PLUGIN_ROUTE_NAMESPACE}/${splat ?? ""}`;
	const page = findPluginPage(pages, path);

	if (!page) {
		return (
			<div className="mx-auto max-w-xl px-5 py-8">
				<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="plugin-page-not-found">
					Page not found
				</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					No plugin provides a page at <code className="bg-muted rounded px-1">{path}</code>.
				</p>
			</div>
		);
	}

	// Electron-only plugins have no backend in standalone browser mode —
	// render an explicit unavailable state instead of a dead page.
	if (!page.browserSafe && !desktopAvailable) {
		const title = page.title ?? page.path;
		return (
			<div className="mx-auto max-w-xl px-5 py-8">
				<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="plugin-page-heading">
					{title}
				</h1>
				<p className="text-muted-foreground mt-1 text-sm" data-qa-id="plugin-page-unavailable">
					{title} is not available in browser mode. Run the desktop app to use this feature.
				</p>
			</div>
		);
	}

	const Page = page.component;
	const Sidecar = page.sidecar ? sidecars[page.sidecar] : undefined;
	if (!Sidecar) return <Page path={page.path} search={search} />;

	return (
		<div className="flex h-full min-h-0 min-w-0" data-qa-id="plugin-page-with-sidecar">
			<div className="min-h-0 min-w-0 flex-1">
				<Page path={page.path} search={search} />
			</div>
			<aside
				className="border-border flex min-h-0 min-w-96 flex-[0_1_42%] border-l"
				data-qa-id={`plugin-sidecar-${page.sidecar}`}
			>
				<Sidecar search={search} />
			</aside>
		</div>
	);
}
