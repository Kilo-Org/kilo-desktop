import {
	KernelNativeTheme,
	mainHost,
	type DomainProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { getThemeChrome, normalizeAppThemePreferences } from "@kilo-desktop/ui/themes/app-themes";
import { normalizeTextSizes } from "@kilo-desktop/ui/themes/theme-tokens";

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
 */
export function provideAppearance(sdk: PluginSdk): void {
	const store = mainHost(sdk).storage.kv<{ preferences: AppearanceState }>({
		defaults: { preferences: DEFAULT_APPEARANCE },
		namespace: "appearance",
	});
	const syncNativeTheme = (state: AppearanceState) => {
		const nativeTheme = sdk.domains.get(KernelNativeTheme);
		if (!nativeTheme) return;
		void nativeTheme.methods.setSource({ source: state.source }).catch(() => {});
		void nativeTheme.methods.setChrome(getThemeChrome(state.themeId)).catch(() => {});
	};

	const provider: DomainProvider<typeof Appearance> = sdk.domains.provide(Appearance, {
		initialState: normalize(DEFAULT_APPEARANCE, store.get("preferences")),
		methods: {
			update: (patch) => {
				const next = { ...normalize(provider.state, patch), persisted: true };
				store.set({ preferences: next });
				provider.setState(next);
				syncNativeTheme(next);
				return next;
			},
		},
	});
	syncNativeTheme(provider.state);
	sdk.domains.track(KernelNativeTheme, {
		added: () => syncNativeTheme(provider.state),
		removed: () => {},
	});
}

function normalize(
	current: AppearanceState,
	patch: AppearancePatch | AppearanceState,
): AppearanceState {
	const defined = Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined),
	);
	const merged: AppearanceState = { ...current, ...defined };
	const theme = normalizeAppThemePreferences({
		themeId: merged.themeId,
		accentId: merged.accentId,
	});
	return {
		...merged,
		themeId: theme.themeId,
		accentId: theme.accentId,
		textSizes: normalizeTextSizes(merged.textSizes),
	};
}
