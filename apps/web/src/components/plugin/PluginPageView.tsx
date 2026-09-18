import {
	PLUGIN_ROUTE_NAMESPACE,
	type PluginPageSurface as PluginPageSurfaceKind,
} from "@kilo-desktop/feature-sdk";

import type { ReactNode } from "react";

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
};

function PluginPageSurface({
	children,
	surface = "default",
}: {
	children: ReactNode;
	surface?: PluginPageSurfaceKind;
}) {
	return (
		<div
			className={
				surface === "transparent" ? "h-full min-h-0 bg-transparent" : "bg-background h-full min-h-0"
			}
			data-qa-id="plugin-page-surface"
			data-surface={surface}
		>
			{children}
		</div>
	);
}

function PluginFallbackPage({
	headingQaId,
	children,
}: {
	headingQaId: string;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col" data-qa-id={headingQaId}>
			<div className="mx-auto w-full max-w-xl px-5 py-8">{children}</div>
		</div>
	);
}

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
}: PluginPageViewProps) {
	const path = `${PLUGIN_ROUTE_NAMESPACE}/${splat ?? ""}`;
	const page = findPluginPage(pages, path);

	if (!page) {
		return (
			<PluginPageSurface>
				<PluginFallbackPage headingQaId="plugin-page-not-found">
					<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
						No plugin provides a page at <code className="bg-muted rounded px-1">{path}</code>.
					</p>
				</PluginFallbackPage>
			</PluginPageSurface>
		);
	}

	// Electron-only plugins have no backend in standalone browser mode —
	// render an explicit unavailable state instead of a dead page.
	if (!page.browserSafe && !desktopAvailable) {
		const title = page.title ?? page.path;
		return (
			<PluginPageSurface surface={page.surface}>
				<PluginFallbackPage headingQaId="plugin-page-heading">
					<p
						className="text-muted-foreground mt-0.5 text-sm leading-snug"
						data-qa-id="plugin-page-unavailable"
					>
						{title} is not available in browser mode. Run the desktop app to use this feature.
					</p>
				</PluginFallbackPage>
			</PluginPageSurface>
		);
	}

	const Page = page.component;
	return (
		<PluginPageSurface surface={page.surface}>
			<Page path={page.path} search={search} />
		</PluginPageSurface>
	);
}
