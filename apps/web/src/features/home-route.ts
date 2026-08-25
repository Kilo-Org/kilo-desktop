import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };

/** Derives the catch-all splat for the app's default plugin page. */
export function deriveHomeSplat(routePath: string | undefined): string {
	if (routePath === undefined) {
		throw new Error("kilo-ui plugin.json must declare at least one contributed route");
	}
	return routePath.replace(/^\//, "");
}

export const HOME_PLUGIN_SPLAT = deriveHomeSplat(kiloUiManifest.contributes.routes[0]?.path);
