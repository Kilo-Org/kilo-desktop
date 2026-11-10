import type { DomainObjectProvider, PluginSdk } from "@kilo-desktop/kernel";
import { getThemeAppearance, themeCss } from "@kilo-desktop/ui/themes/app-themes";
import {
	APP_THEME_STORAGE_KEY,
	normalizeTextSizes,
	resolveColorScheme,
	SIDEBAR_VIBRANCY_STORAGE_KEY,
	TEXT_SIZE_CSS_VARS,
	TEXT_SIZE_STORAGE_KEY,
	THEME_SOURCES,
	THEME_STORAGE_KEY,
	type ResolvedColorScheme,
	type ThemeSource,
} from "@kilo-desktop/ui/themes/theme-tokens";

import { Appearance, DEFAULT_APPEARANCE, Theme, type AppearanceState } from "../../contracts";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * Applies the appearance preferences to this window's document (colour
 * scheme, theme tokens, glass, text sizes) and publishes the effective theme
 * as the Theme domain object. Runs in every window, including pop-outs, so it
 * lives outside React. Preferences are also cached in localStorage, which the
 * pre-React bootstrap script reads to paint the first frame correctly.
 */
export function startThemeRuntime(sdk: PluginSdk): void {
	const darkQuery = globalThis.matchMedia(DARK_SCHEME_QUERY);
	// Read before the first apply overwrites the cache: earlier versions kept preferences only here.
	const legacy = hasCachedAppearance() ? readCachedAppearance() : null;
	let preferences = sdk.domainObjects.get(Appearance)?.getState() ?? legacy ?? DEFAULT_APPEARANCE;

	const resolveMode = (): ResolvedColorScheme =>
		resolveColorScheme(preferences.source, darkQuery.matches);
	const themeState = () => {
		const mode = resolveMode();
		const appearance = getThemeAppearance(
			{ themeId: preferences.themeId, accentId: preferences.accentId },
			mode,
		);
		return {
			mode,
			themeId: appearance.themeId,
			accentId: preferences.accentId,
			terminal: appearance.terminal,
			shiki: appearance.shiki,
		};
	};

	const theme: DomainObjectProvider<typeof Theme> = sdk.domainObjects.provide(Theme, {
		initialState: themeState(),
		methods: {},
	});
	const apply = () => {
		applyToDocument(preferences, resolveMode());
		cacheAppearance(preferences);
		theme.setState(themeState());
	};
	apply();

	const onSchemeChange = () => apply();
	darkQuery.addEventListener("change", onSchemeChange);
	sdk.onDispose(() => darkQuery.removeEventListener("change", onSchemeChange));

	sdk.domainObjects.track(Appearance, {
		added: (appearance) => {
			preferences = appearance.getState();
			adoptLocalAppearanceOnce(
				legacy,
				preferences,
				(cached) => void appearance.methods.update(cached).catch(() => {}),
			);
			apply();
			appearance.subscribe((next) => {
				preferences = next;
				apply();
			});
		},
		removed: () => {},
	});
}

/** Set once this profile's locally kept appearance has been offered to main. */
export const LOCAL_APPEARANCE_ADOPTED_KEY = "kilo.shell:local-appearance-adopted";

/**
 * Versions before main kept appearance stored it only in localStorage. The
 * first time a window meets main's appearance, it hands that over, but only
 * while main still holds the defaults (so main has never saved a choice) and
 * the local copy differs. Never again afterwards, so the local cache, which
 * mirrors main from then on, can't overwrite a choice made elsewhere.
 */
function adoptLocalAppearanceOnce(
	legacy: AppearanceState | null,
	saved: AppearanceState,
	adopt: (cached: AppearanceState) => void,
): void {
	try {
		if (localStorage.getItem(LOCAL_APPEARANCE_ADOPTED_KEY) !== null) return;
		localStorage.setItem(LOCAL_APPEARANCE_ADOPTED_KEY, "1");
	} catch {
		return;
	}
	if (!legacy || !sameAppearance(saved, DEFAULT_APPEARANCE) || sameAppearance(legacy, saved))
		return;
	adopt(legacy);
}

function sameAppearance(left: AppearanceState, right: AppearanceState): boolean {
	return (
		left.source === right.source &&
		left.themeId === right.themeId &&
		left.accentId === right.accentId &&
		left.sidebarVibrancy === right.sidebarVibrancy &&
		left.textSizes.ui === right.textSizes.ui &&
		left.textSizes.chat === right.textSizes.chat
	);
}

function applyToDocument(preferences: AppearanceState, mode: ResolvedColorScheme): void {
	const root = document.documentElement;
	if (mode === "dark") root.dataset.theme = "dark";
	else delete root.dataset.theme;
	root.style.colorScheme = mode;

	let style = document.getElementById("app-theme");
	if (!style) {
		style = document.createElement("style");
		style.id = "app-theme";
		document.head.append(style);
	}
	style.textContent = themeCss({ themeId: preferences.themeId, accentId: preferences.accentId });

	if (preferences.sidebarVibrancy) root.style.removeProperty("--shell-glass-opacity");
	else root.style.setProperty("--shell-glass-opacity", "100%");

	const sizes = normalizeTextSizes(preferences.textSizes);
	root.style.setProperty(TEXT_SIZE_CSS_VARS.ui, `${sizes.ui}px`);
	root.style.setProperty(TEXT_SIZE_CSS_VARS.chat, `${sizes.chat}px`);
}

function cacheAppearance(preferences: AppearanceState): void {
	try {
		localStorage.setItem(THEME_STORAGE_KEY, preferences.source);
		localStorage.setItem(
			APP_THEME_STORAGE_KEY,
			JSON.stringify({ themeId: preferences.themeId, accentId: preferences.accentId }),
		);
		localStorage.setItem(SIDEBAR_VIBRANCY_STORAGE_KEY, String(preferences.sidebarVibrancy));
		localStorage.setItem(TEXT_SIZE_STORAGE_KEY, JSON.stringify(preferences.textSizes));
	} catch {
		// Private mode or quota: the next window paints from defaults until preferences arrive.
	}
}

function hasCachedAppearance(): boolean {
	try {
		return [
			THEME_STORAGE_KEY,
			APP_THEME_STORAGE_KEY,
			SIDEBAR_VIBRANCY_STORAGE_KEY,
			TEXT_SIZE_STORAGE_KEY,
		].some((key) => localStorage.getItem(key) !== null);
	} catch {
		return false;
	}
}

function readCachedAppearance(): AppearanceState {
	const read = (key: string) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const parse = (raw: string | null): unknown => {
		try {
			return raw === null ? null : JSON.parse(raw);
		} catch {
			return null;
		}
	};
	const source = read(THEME_STORAGE_KEY);
	const theme = parse(read(APP_THEME_STORAGE_KEY)) as {
		themeId?: unknown;
		accentId?: unknown;
	} | null;
	const textSizes = parse(read(TEXT_SIZE_STORAGE_KEY));
	return {
		...DEFAULT_APPEARANCE,
		...(THEME_SOURCES.includes(source as ThemeSource) ? { source: source as ThemeSource } : {}),
		...(typeof theme?.themeId === "string" ? { themeId: theme.themeId } : {}),
		...(typeof theme?.accentId === "string" ? { accentId: theme.accentId } : {}),
		sidebarVibrancy: read(SIDEBAR_VIBRANCY_STORAGE_KEY) !== "false",
		...(textSizes ? { textSizes: normalizeTextSizes(textSizes) } : {}),
	};
}
