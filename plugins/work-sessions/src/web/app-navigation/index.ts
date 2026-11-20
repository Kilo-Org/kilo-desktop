import type { PluginSdk } from "@kilo-desktop/kernel";
import { ShortcutsPanel } from "@kilo-desktop/plugin-shell/contracts";

import { AppNavigationPanel } from "./AppNavigationPanel";
import { appNavigationListRows } from "./use-number-sets";

/**
 * The App Navigation area: the modifier the tab and session numbers (⌘1–9,
 * ⌃1–9) jump with, edited as one set each in Settings → Shortcuts and listed
 * as one row each in the ⌘/ list.
 */
export function activateAppNavigation(sdk: PluginSdk): void {
	sdk.extensions.implement(ShortcutsPanel, "app-navigation", {
		component: AppNavigationPanel,
		listRows: appNavigationListRows,
	});
}
