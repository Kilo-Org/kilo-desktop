import { useEffect } from "react";

import { router } from "@/router";

import { useLocalApi } from "./LocalApiProvider";

/**
 * Applies main-process deep-link navigations (`shell:navigate`) to the shell
 * router. Pane windows ignore the event so popped-out views stay on their route.
 */
export function ShellNavigationListener() {
	const api = useLocalApi();

	useEffect(() => {
		if (api.shell.windowRole === "pane") return;
		return api.shell.onNavigate((target) => {
			const params = new URLSearchParams(target.search);
			const href = params.size > 0 ? `${target.path}?${params}` : target.path;
			router.history.push(href);
		});
	}, [api]);

	return null;
}
