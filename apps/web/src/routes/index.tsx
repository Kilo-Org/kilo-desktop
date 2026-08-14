import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Derives the home redirect splat (the `/plugins/$` param) from the kilo-ui
 * plugin's first contributed route. Pure + exported so both the happy path and
 * the "no contributed route" guard can be unit-tested without importing the
 * side-effecting route module.
 */
export function deriveHomeSplat(routePath: string | undefined): string {
	if (routePath === undefined) {
		throw new Error("kilo-ui plugin.json must declare at least one contributed route");
	}
	return routePath.replace(/^\//, "");
}

const homeSplat = deriveHomeSplat(kiloUiManifest.contributes.routes[0]?.path);

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({
			to: "/plugins/$",
			params: { _splat: homeSplat },
		});
	},
});
