import { KernelWindowView, type PluginSdk } from "@kilo-desktop/kernel";

import { PaneWindowView } from "./PaneWindowView";
import { reconcilePopOuts } from "./pop-outs";

/**
 * The panes area: popped-out panes. Every window can show one (`kernel/window-view`
 * `pane`); the main window keeps them in step with its open work session.
 */
export function activatePanes(sdk: PluginSdk): void {
	sdk.extensions.implement(KernelWindowView, "pane", PaneWindowView);
	if (sdk.context.get("kernel/secondaryWindow")) return;
	sdk.onDispose(reconcilePopOuts(sdk));
}
