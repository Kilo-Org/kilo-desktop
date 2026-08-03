import { createFileRoute } from "@tanstack/react-router";

import { PluginPageView } from "@/components/plugin/PluginPageView";

/**
 * Shell-owned catch-all for plugin routes, mounted under the `/plugins`
 * namespace (Decision #19). Every plugin-declared route resolves under
 * `/plugins/<path>` — the loader prefixes manifest paths so shell routes and
 * plugin routes cannot collide by construction. Adding a plugin route
 * requires no shell source change and plugins never import the router.
 */
export const Route = createFileRoute("/plugins/$")({
	component: PluginCatchAllRoute,
});

function PluginCatchAllRoute() {
	const { _splat } = Route.useParams();
	const search = Route.useSearch() as Record<string, unknown>;
	return <PluginPageView splat={_splat} search={search} />;
}
