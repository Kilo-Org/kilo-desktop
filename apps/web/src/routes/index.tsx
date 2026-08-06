import kiloUiManifest from "@anaconda-agentic-desktop/plugin-kilo-ui/plugin.json" with { type: "json" };
import { createFileRoute, redirect } from "@tanstack/react-router";

const homeRoutePath = kiloUiManifest.contributes.routes[0]?.path;
if (homeRoutePath === undefined) {
	throw new Error("kilo-ui plugin.json must declare at least one contributed route");
}
const homeSplat = homeRoutePath.replace(/^\//, "");

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({
			to: "/plugins/$",
			params: { _splat: homeSplat },
		});
	},
});
