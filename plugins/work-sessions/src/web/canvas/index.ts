import type { PluginSdk } from "@kilo-desktop/kernel";
import { Main } from "@kilo-desktop/plugin-shell/contracts";

import { WorkSessionHeaderActions, WorkSessionHeaderLeading } from "./WorkSessionHeader";
import { WorkSessionsMain } from "./WorkSessionsMain";

/**
 * The canvas area: the main area (`kilo.shell/main` `work-sessions`) with the
 * open work session's canvas and its header, a work sessions view, or the
 * New Session page. Only the main window shows work sessions.
 */
export function activateCanvas(sdk: PluginSdk): void {
	if (sdk.context.get("kernel/secondaryWindow")) return;
	sdk.extensions.implement(Main, "work-sessions", {
		component: WorkSessionsMain,
		headerLeading: WorkSessionHeaderLeading,
		headerActions: WorkSessionHeaderActions,
	});
}
