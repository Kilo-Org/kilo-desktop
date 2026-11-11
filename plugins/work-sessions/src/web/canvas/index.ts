import type { PluginSdk } from "@kilo-desktop/kernel";
import { Main, TopBarAction, TopBarTitle } from "@kilo-desktop/plugin-shell/contracts";

import {
	ViewTopBarActions,
	ViewTopBarTitle,
	WorkSessionTopBarActions,
	WorkSessionTopBarTitle,
} from "./WorkSessionTopBar";
import { WorkSessionsMain } from "./WorkSessionsMain";

/**
 * The canvas area: the main area (`kilo.shell/main` `work-sessions`) with the
 * open work session's canvas and its header (`kilo.shell/top-bar-title` and
 * `top-bar-action`), a work sessions view, or the
 * New Session page. Only the main window shows work sessions.
 */
export function activateCanvas(sdk: PluginSdk): void {
	if (sdk.context.get("kernel/secondaryWindow")) return;
	sdk.extensions.implement(Main, "work-sessions", { component: WorkSessionsMain });
	// Listed only while what they show is there (see plugin.json `when`), so the
	// New Session page leaves the window's top bar empty.
	sdk.extensions.implement(TopBarTitle, "session-title", WorkSessionTopBarTitle);
	sdk.extensions.implement(TopBarAction, "session-actions", WorkSessionTopBarActions);
	sdk.extensions.implement(TopBarTitle, "view-title", ViewTopBarTitle);
	sdk.extensions.implement(TopBarAction, "view-actions", ViewTopBarActions);
}
