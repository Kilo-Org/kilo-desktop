import { createElement } from "react";

import { KernelCommand, KernelRoot, KernelWindows, type PluginSdk } from "@kilo-desktop/kernel";

import { startAppMenu } from "./app-menu";
import { connectWindowNavigation, routeDeepLinks, routerGo } from "./navigation";
import { createShellRouter } from "./router";
import { ShellRoot } from "./ShellRoot";
import { startThemeRuntime } from "./theme-runtime";
import { createShellUiState } from "./ui-state";

/**
 * The frame area. Every window gets the theme runtime (it provides
 * `kilo.shell/theme`, so it starts first) and its native app menu; secondary
 * windows close with `close-window`. The main window also gets the router,
 * the frame, its link to `kilo.shell/navigation`, deep links and the
 * window commands, which move this window's router directly.
 */
export function activateFrame(sdk: PluginSdk): void {
	startThemeRuntime(sdk);
	startAppMenu(sdk);

	// Bound only in secondary windows (its `when`); there ⌘W closes the window itself.
	sdk.extensions.implement(KernelCommand, "close-window", () => {
		if (!sdk.windowId) return;
		return sdk.domainObjects.get(KernelWindows)?.methods.close({ windowId: sdk.windowId });
	});

	if (sdk.context.get("kernel/secondaryWindow")) return;

	const router = createShellRouter();
	const ui = createShellUiState();
	const go = routerGo(router);
	connectWindowNavigation(sdk, router, ui);
	routeDeepLinks(sdk, go);
	sdk.extensions.implement(KernelRoot, "frame", function ShellFrame() {
		return createElement(ShellRoot, { router, ui });
	});

	sdk.extensions.implement(KernelCommand, "open-settings", () => go("/settings"));
	sdk.extensions.implement(KernelCommand, "go-home", () => go("/"));
	sdk.extensions.implement(KernelCommand, "toggle-sidebar", () => ui.toggleSidebar());
	sdk.extensions.implement(KernelCommand, "command-palette", () =>
		ui.setPaletteOpen(!ui.isPaletteOpen()),
	);
	sdk.extensions.implement(KernelCommand, "show-shortcuts", () =>
		ui.setShortcutsOpen(!ui.isShortcutsOpen()),
	);
}
