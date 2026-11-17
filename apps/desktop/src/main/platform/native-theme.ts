import { nativeTheme, type NativeTheme } from "electron";

import { DEFAULT_THEME_SOURCE } from "@kilo-desktop/ui/themes/theme-tokens";

import type { ElectronWindow } from "./ElectronWindow.js";
import type { PreferencesStore } from "./PreferencesStore.js";

/**
 * Native chrome (window background, Windows/Linux title bar overlay) is
 * painted once at creation, so it must be repainted when the system scheme
 * changes under a `system` theme source. On Linux the scheme reported by
 * GTK / xdg-desktop-portal often arrives after the first window exists,
 * which otherwise leaves light window controls over a dark renderer.
 */
export function repaintOnSystemColorSchemeChange(
	windows: Pick<ElectronWindow, "applyColorScheme">,
	theme: Pick<NativeTheme, "on" | "off"> = nativeTheme,
): () => void {
	const repaint = () => windows.applyColorScheme();
	theme.on("updated", repaint);
	return () => theme.off("updated", repaint);
}

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
