import kiloCodeManifest from "@anaconda-agentic-desktop/plugin-kilo-code/plugin.json" with { type: "json" };
import { createFileRoute, redirect } from "@tanstack/react-router";

const homeRoutePath = kiloCodeManifest.contributes.routes[0]?.path;
if (homeRoutePath === undefined) {
	throw new Error("kilo-code plugin.json must declare at least one contributed route");
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
