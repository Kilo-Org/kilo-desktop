import {
	APP_THEME_STORAGE_KEY,
	DEFAULT_APP_THEME_PREFERENCES,
	getThemeAppearance,
	normalizeAppThemePreferences,
	themeCss,
	type AppThemePreferences,
} from "@kilo-desktop/contracts";
import { createObservableValue, type ThemeAppearance } from "@kilo-desktop/feature-sdk";

import { getColorSchemeSnapshot } from "./color-scheme";

/**
 * The shell owns one appearance snapshot per renderer. CSS is applied before
 * subscribers are notified so embedded surfaces can read the new tokens.
 * Preferences are authoritative.
 */
const appTheme = createObservableValue(readStoredAppTheme());
let appearance = getThemeAppearance(appTheme.peek(), getColorSchemeSnapshot());

export function readStoredAppTheme(): AppThemePreferences {
	try {
		return normalizeAppThemePreferences(
			JSON.parse(localStorage.getItem(APP_THEME_STORAGE_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_APP_THEME_PREFERENCES;
	}
}

export function getAppearanceSnapshot(): ThemeAppearance {
	const mode = getColorSchemeSnapshot();
	if (appearance.mode !== mode) appearance = getThemeAppearance(appTheme.peek(), mode);
	return appearance;
}

export function getAppThemePreferencesSnapshot(): AppThemePreferences {
	return appTheme.peek();
}

export function subscribeAppTheme(listener: () => void): () => void {
	return appTheme.subscribe(listener);
}

export function applyAppTheme(next: AppThemePreferences): void {
	const normalized = normalizeAppThemePreferences(next);
	const css = themeCss(normalized);
	let style = document.getElementById("app-theme");
	if (!css) style?.remove();
	else {
		if (!style) {
			style = document.createElement("style");
			style.id = "app-theme";
			document.head.append(style);
		}
		style.textContent = css;
	}
	try {
		localStorage.setItem(APP_THEME_STORAGE_KEY, JSON.stringify(normalized));
	} catch {
		// Disabled storage must not prevent changing appearance for this session.
	}
	const current = appTheme.peek();
	if (current.themeId === normalized.themeId && current.accentId === normalized.accentId) return;
	appearance = getThemeAppearance(normalized, getColorSchemeSnapshot());
	appTheme.set(normalized);
}

if (import.meta.hot) {
	import.meta.hot.accept(() => applyAppTheme(readStoredAppTheme()));
}
