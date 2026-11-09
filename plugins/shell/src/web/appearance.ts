import { useCallback } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import type { AppThemePreferences } from "@kilo-desktop/ui/themes/app-themes";
import type {
	ResolvedColorScheme,
	TextSizes,
	TextSizeTarget,
	ThemeSource,
} from "@kilo-desktop/ui/themes/theme-tokens";

import {
	Appearance,
	DEFAULT_APPEARANCE,
	Theme,
	type AppearancePatch,
	type AppearanceState,
} from "../contracts";

const selectAppearance = (state: AppearanceState) => state;
const selectMode = (state: { mode: ResolvedColorScheme }) => state.mode;

export interface AppearanceControls {
	readonly source: ThemeSource;
	readonly resolved: ResolvedColorScheme;
	readonly setSource: (source: ThemeSource) => void;
	readonly sidebarVibrancy: boolean;
	readonly setSidebarVibrancy: (enabled: boolean) => void;
	readonly appTheme: AppThemePreferences;
	readonly setAppTheme: (preferences: AppThemePreferences) => void;
	readonly textSizes: TextSizes;
	readonly setTextSize: (target: TextSizeTarget, px: number) => void;
}

/** Appearance preferences and setters, backed by the Appearance domain object. */
export function useAppearance(): AppearanceControls {
	const appearance = useDomain(Appearance);
	const state = useDomainState(Appearance, selectAppearance) ?? DEFAULT_APPEARANCE;
	const resolved = useDomainState(Theme, selectMode) ?? "dark";
	const update = useCallback(
		(patch: AppearancePatch) => void appearance?.methods.update(patch).catch(() => {}),
		[appearance],
	);
	return {
		source: state.source,
		resolved,
		setSource: (source) => update({ source }),
		sidebarVibrancy: state.sidebarVibrancy,
		setSidebarVibrancy: (sidebarVibrancy) => update({ sidebarVibrancy }),
		appTheme: { themeId: state.themeId, accentId: state.accentId },
		setAppTheme: ({ themeId, accentId }) => update({ themeId, accentId }),
		textSizes: state.textSizes,
		setTextSize: (target, px) => update({ textSizes: { ...state.textSizes, [target]: px } }),
	};
}
