import type { PluginSdk } from "@kilo-desktop/kernel";

import { resetListState } from "../shared/list-state";
import { startFromNewWorkSessionPage } from "../shared/new-work-session-start";
import { bindFailureReports } from "../shared/report-failure";
import { implementPaneCommands, implementWorkSessionCommands, openOrShowPane } from "./commands";
import { provideWorkSessionsWindow } from "./provide-window";

/**
 * The window area: this window's `kilo.work-sessions/window` object, its
 * context keys, and the commands that move between work sessions and panes.
 * Runs first: the other web areas read the window object. Only the main
 * window shows work sessions, so secondary windows (pop-outs) get none of it.
 */
export function activateWindow(sdk: PluginSdk): void {
	resetListState();
	sdk.onDispose(bindFailureReports(sdk));
	if (sdk.context.get("kernel/secondaryWindow")) return;
	const { showInPlace } = provideWorkSessionsWindow(sdk, {
		openPane: (workSessionId, kind, placement) =>
			openOrShowPane(sdk, workSessionId, kind, placement),
		startWithPane: (kind) => void startFromNewWorkSessionPage(kind),
	});
	implementWorkSessionCommands(sdk, showInPlace);
	implementPaneCommands(sdk);
}
