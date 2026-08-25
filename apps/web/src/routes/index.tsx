import { createFileRoute, redirect } from "@tanstack/react-router";

import { HOME_PLUGIN_SPLAT } from "@/features/home-route";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({
			to: "/plugins/$",
			params: { _splat: HOME_PLUGIN_SPLAT },
		});
	},
});
