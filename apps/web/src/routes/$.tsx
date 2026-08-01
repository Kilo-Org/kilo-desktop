import { createFileRoute } from "@tanstack/react-router";

import { PluginPageView } from "@/components/plugin/PluginPageView";

/**
 * Shell-owned catch-all for plugin routes (Decision #19). Any path not
 * claimed by a shell route file resolves against the plugin manifest
 * registry at render time — adding a plugin route requires no shell source
 * change and plugins never import the router.
 */
export const Route = createFileRoute("/$")({
	component: PluginCatchAllRoute,
});

function PluginCatchAllRoute() {
	const { _splat } = Route.useParams();
	const search = Route.useSearch() as Record<string, unknown>;
	return <PluginPageView splat={_splat} search={search} />;
}
