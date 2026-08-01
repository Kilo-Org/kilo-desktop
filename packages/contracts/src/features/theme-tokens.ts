export const THEME_SOURCES = ["system", "light", "dark"] as const;
export type ThemeSource = (typeof THEME_SOURCES)[number];
export type ResolvedColorScheme = "light" | "dark";

/** localStorage key for the renderer-owned theme source (and the pre-paint bootstrap). */
export const THEME_STORAGE_KEY = "theme:v1";

/**
 * Hex paint tokens for first paint / native chrome.
 * Equivalents of `--storm-100` / `--storm-900` / `--storm-50`
 * (apps/web/.../color-primitives.css) — Electron and the critical HTML style
 * cannot use oklch.
 */
export const themeChromeColors = {
	light: { background: "#f3f5f8", foreground: "#1a1a1a" },
	dark: { background: "#141820", foreground: "#f9fafb" },
} as const;

export type ThemeChromeColors = (typeof themeChromeColors)[keyof typeof themeChromeColors];

export function resolveShouldUseDarkColors(source: ThemeSource, systemDark: boolean): boolean {
	if (source === "system") return systemDark;
	return source === "dark";
}

export function resolveColorScheme(source: ThemeSource, systemDark: boolean): ResolvedColorScheme {
	return resolveShouldUseDarkColors(source, systemDark) ? "dark" : "light";
}

export function chromeFor(shouldUseDarkColors: boolean): ThemeChromeColors {
	return shouldUseDarkColors ? themeChromeColors.dark : themeChromeColors.light;
}

/** Critical first-paint CSS — injected into index.html by the Vite plugin. */
export function criticalThemeStyle(): string {
	const { light, dark } = themeChromeColors;
	return `html{background:${light.background}}html[data-theme="dark"]{background:${dark.background}}`;
}

/**
 * Pre-paint bootstrap IIFE — injected into index.html by the Vite plugin.
 * Mirrors readStoredThemeSource / resolveColorScheme / applyDocumentColorScheme.
 */
export function themeBootstrapScript(): string {
	const key = JSON.stringify(THEME_STORAGE_KEY);
	return `(function(){var k=${key},s="system";try{var v=localStorage.getItem(k);if(v==="light"||v==="dark"||v==="system")s=v}catch(e){}var d=s==="dark"||(s==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.dataset.theme="dark";else delete r.dataset.theme;r.style.colorScheme=d?"dark":"light"})();`;
}
