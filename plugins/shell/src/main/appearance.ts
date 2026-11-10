import {
	KernelNativeTheme,
	mainHost,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { getThemeChrome, normalizeAppThemePreferences } from "@kilo-desktop/ui/themes/app-themes";
import { normalizeTextSizes, THEME_SOURCES } from "@kilo-desktop/ui/themes/theme-tokens";

import {
	Appearance,
	DEFAULT_APPEARANCE,
	type AppearancePatch,
	type AppearanceState,
} from "../contracts";

/**
 * Owns the appearance preferences in main: saved in kilo.shell's kv store,
 * shared with every window through the Appearance domain object, and mirrored
 * to the OS (colour scheme and native window chrome) via kernel/native-theme.
 * Earlier versions saved the same record with a `persisted` flag beside it;
 * reading keeps only the known fields, so that record is adopted as it is.
 * Appearance kept only in a window's localStorage (older still) is adopted by
 * the window's theme runtime, which alone can read it.
 */
export function provideAppearance(sdk: PluginSdk): void {
	const store = mainHost(sdk).storage.kv<{ preferences: AppearanceState }>({
		defaults: { preferences: DEFAULT_APPEARANCE },
		namespace: "appearance",
	});
	const syncNativeTheme = (state: AppearanceState) => {
		const nativeTheme = sdk.domainObjects.get(KernelNativeTheme);
		if (!nativeTheme) return;
		void nativeTheme.methods.setSource({ source: state.source }).catch(() => {});
		void nativeTheme.methods.setChrome(getThemeChrome(state.themeId)).catch(() => {});
	};

	const provider: DomainObjectProvider<typeof Appearance> = sdk.domainObjects.provide(Appearance, {
		initialState: normalize(DEFAULT_APPEARANCE, store.get("preferences")),
		methods: {
			update: (patch) => {
				const next = normalize(provider.state, patch);
				store.set({ preferences: next });
				provider.setState(next);
				syncNativeTheme(next);
				return next;
			},
		},
	});
	syncNativeTheme(provider.state);
	sdk.domainObjects.track(KernelNativeTheme, {
		added: () => syncNativeTheme(provider.state),
		removed: () => {},
	});
}

function normalize(current: AppearanceState, patch: AppearancePatch): AppearanceState {
	const merged: AppearanceState = { ...current, ...definedFields(patch) };
	const theme = normalizeAppThemePreferences({
		themeId: merged.themeId,
		accentId: merged.accentId,
	});
	return {
		source: THEME_SOURCES.includes(merged.source) ? merged.source : current.source,
		themeId: theme.themeId,
		accentId: theme.accentId,
		sidebarVibrancy: merged.sidebarVibrancy !== false,
		textSizes: normalizeTextSizes(merged.textSizes),
	};
}

function definedFields(patch: AppearancePatch): Partial<AppearanceState> {
	return Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined),
	) as Partial<AppearanceState>;
}
