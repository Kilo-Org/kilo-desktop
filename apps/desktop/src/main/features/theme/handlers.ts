import { nativeTheme, type NativeTheme } from "electron";

import type { IpcHandlers } from "@kilo-desktop/contracts";

import type { ElectronWindow } from "../../platform/ElectronWindow.js";
import type { PreferencesStore } from "../../platform/PreferencesStore.js";

/**
 * Restore nativeTheme from preferences before the first window is created so
 * backgroundColor / dialogs / menus agree with the renderer-owned source.
 */
export function restoreNativeThemeFromPreferences(
	preferences: PreferencesStore,
	theme: Pick<NativeTheme, "themeSource"> = nativeTheme,
): void {
	theme.themeSource = preferences.themeSource ?? "system";
}

/**
 * The renderer owns theme state; main only mirrors it so native chrome can
 * match. `theme:sync` is the single one-way entry point.
 */
export function createThemeHandlers(
	electronWindow: ElectronWindow,
	preferences: PreferencesStore,
	theme: Pick<NativeTheme, "themeSource"> = nativeTheme,
): Pick<IpcHandlers, "theme:sync"> {
	return {
		"theme:sync": (state) => {
			preferences.setThemeSource(state.source);
			preferences.setThemeId(state.themeId);
			theme.themeSource = state.source;
			electronWindow.applyColorScheme();
			return undefined;
		},
	};
}
