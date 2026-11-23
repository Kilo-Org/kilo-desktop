import { definePlugin } from "@kilo-desktop/kernel";

import { activateAppNavigation } from "./app-navigation";
import { activateAttention } from "./attention";
import { activateCanvas } from "./canvas";
import { activateHome } from "./home";
import { activateLayouts } from "./layouts";
import { activateList } from "./list";
import { activateNotifications } from "./notifications";
import { activatePanes } from "./panes";
import { activateSaved } from "./saved";
import { activateViews } from "./views";
import { activateWindow } from "./window";
import { activateWorkspaces } from "./workspaces";

/**
 * kilo.work-sessions in a window, composed from areas that meet through the
 * plugin's contracts and `./shared`. The window area goes first: it provides
 * `kilo.work-sessions/window`, which every other area reads.
 */
export const workSessionsWebEntry = definePlugin({
	activate(sdk) {
		activateWindow(sdk);
		activateCanvas(sdk);
		activatePanes(sdk);
		activateLayouts(sdk);
		activateViews(sdk);
		activateSaved(sdk);
		activateAttention(sdk);
		activateList(sdk);
		activateHome(sdk);
		activateNotifications(sdk);
		activateAppNavigation(sdk);
		activateWorkspaces(sdk);
	},
});
