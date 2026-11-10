import { KernelWindowView, type PluginSdk } from "@kilo-desktop/kernel";

import { WorkSessionsViewWindow } from "./WorkSessionsViewHost";

/**
 * The views area: hosting `kilo.work-sessions/work-sessions-view`
 * contributions in place of the open work session (through the canvas's main
 * area) and in their own windows (`kernel/window-view` `work-sessions-view`).
 */
export function activateViews(sdk: PluginSdk): void {
	sdk.extensions.implement(KernelWindowView, "work-sessions-view", WorkSessionsViewWindow);
}
