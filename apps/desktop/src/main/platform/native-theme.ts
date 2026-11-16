import { nativeTheme, type NativeTheme } from "electron";

import { DEFAULT_THEME_SOURCE } from "@kilo-desktop/ui/themes/theme-tokens";

import type { PreferencesStore } from "./PreferencesStore.js";

/**
 * Restore nativeTheme from preferences before the first window is created so
 * backgroundColor / dialogs / menus agree with the renderer-owned source.
 */
export function restoreNativeThemeFromPreferences(
	preferences: Pick<PreferencesStore, "themeSource">,
	theme: Pick<NativeTheme, "themeSource"> = nativeTheme,
): void {
	theme.themeSource = preferences.themeSource ?? DEFAULT_THEME_SOURCE;
}
