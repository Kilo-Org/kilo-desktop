import type { IpcHandlers } from "$shared";

import type { ElectronTheme } from "../../platform/ElectronTheme.js";
import type { PreferencesStore } from "../../platform/PreferencesStore.js";

export function createThemeHandlers(
	electronTheme: ElectronTheme,
	preferences: PreferencesStore,
): Pick<IpcHandlers, "theme:get" | "theme:set"> {
	return {
		"theme:get": () => electronTheme.state,
		"theme:set": ({ source }) => {
			preferences.setThemeSource(source);
			return electronTheme.setSource(source);
		},
	};
}
