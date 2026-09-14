import {
	APP_THEME_STORAGE_KEY,
	DEFAULT_APP_THEME_PREFERENCES,
	normalizeAppThemePreferences,
	themeCss,
	type AppThemePreferences,
} from "@anaconda-agentic-desktop/contracts";
import { createObservableValue } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * The shell owns one selected theme snapshot per renderer. CSS is applied
 * before subscribers are notified, and normalized preferences are authoritative.
 */
const appTheme = createObservableValue(readStoredAppTheme());

export function readStoredAppTheme(): AppThemePreferences {
	try {
		return normalizeAppThemePreferences(
			JSON.parse(localStorage.getItem(APP_THEME_STORAGE_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_APP_THEME_PREFERENCES;
	}
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
	if (current.themeId === normalized.themeId) return;
	appTheme.set(normalized);
}
