import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	type AnyRouter,
	type RouterHistory,
} from "@tanstack/react-router";

import { Frame } from "./frame/Frame";
import { MainView } from "./frame/MainView";
import { SettingsLanding, SettingsLayout, SettingsSectionRoute } from "./settings/SettingsLayout";

function stringSearch(search: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(search).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/**
 * The main window's routes: the contributed home view at "/" and the
 * settings host at "/settings/<section>". Plugins add views through the
 * shell's extension points, never routes of their own.
 */
export function createShellRouter(history: RouterHistory = createHashHistory()): AnyRouter {
	const root = createRootRoute({
		component: () => (
			<Frame>
				<Outlet />
			</Frame>
		),
		notFoundComponent: MainView,
	});
	const home = createRoute({ getParentRoute: () => root, path: "/", component: MainView });
	const settings = createRoute({
		getParentRoute: () => root,
		path: "/settings",
		component: SettingsLayout,
	});
	const settingsIndex = createRoute({
		getParentRoute: () => settings,
		path: "/",
		component: SettingsLanding,
	});
	const section = createRoute({
		getParentRoute: () => settings,
		path: "$section",
		component: SettingsSectionRoute,
		validateSearch: stringSearch,
	});
	return createRouter({
		routeTree: root.addChildren([home, settings.addChildren([settingsIndex, section])]),
		history,
	}) as unknown as AnyRouter;
}
