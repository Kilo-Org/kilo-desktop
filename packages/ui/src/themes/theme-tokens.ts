export const THEME_SOURCES = ["system", "light", "dark"] as const;
export type ThemeSource = (typeof THEME_SOURCES)[number];
export type ResolvedColorScheme = "light" | "dark";
/** Source used until the user picks one; "system" must be an explicit choice. */
export const DEFAULT_THEME_SOURCE: ThemeSource = "dark";

/** localStorage key for the renderer-owned theme source (and the pre-paint bootstrap). */
export const THEME_STORAGE_KEY = "theme:v1";
export const APP_THEME_STORAGE_KEY = "appTheme:v1";
export const SIDEBAR_VIBRANCY_STORAGE_KEY = "sidebar-vibrancy:v1";
export const TEXT_SIZE_STORAGE_KEY = "textSize:v1";

export type TextSizes = { ui: number; chat: number };
export type TextSizeTarget = keyof TextSizes;
export const DEFAULT_TEXT_SIZES: TextSizes = { ui: 13, chat: 14 };
export const TEXT_SIZE_RANGE = { min: 12, max: 18 } as const;
export const TEXT_SIZE_CSS_VARS: Record<TextSizeTarget, string> = {
	ui: "--app-ui-text-size",
	chat: "--app-chat-text-size",
};

function normalizeTextSize(value: unknown, target: TextSizeTarget): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TEXT_SIZES[target];
	return Math.min(TEXT_SIZE_RANGE.max, Math.max(TEXT_SIZE_RANGE.min, Math.round(value)));
}

export function normalizeTextSizes(input: unknown): TextSizes {
	const stored =
		input && typeof input === "object" && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: {};
	return { ui: normalizeTextSize(stored.ui, "ui"), chat: normalizeTextSize(stored.chat, "chat") };
}

/**
 * Hex paint tokens for native chrome (Linux window background, splash, title-bar symbols).
 * Theme-independent fallback, matching the Anaconda theme in app-themes.ts.
 * macOS uses a transparent window over vibrancy instead.
 */
export const themeChromeColors = {
	light: { background: "#ffffff", foreground: "#090b0c" },
	dark: { background: "#101314", foreground: "#d0d6d8" },
} as const;

export type ThemeChromeColors = { background: string; foreground: string };

/** Transparent paint so macOS vibrancy / Windows mica can show through the webview. */
export const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

/**
 * First-paint / html shell tint opacities — keep in sync with
 * `--shell-glass-opacity` in apps/web/src/globals.css.
 */
export const shellGlassOpacity = {
	light: 64,
	dark: 80,
} as const;

/**
 * Dark shell surface hex (Mist 900): first-paint fallback for `--sidebar`
 * before the theme stylesheet applies.
 */
export const shellGlassDarkSurface = "#161b1d";

export function resolveShouldUseDarkColors(source: ThemeSource, systemDark: boolean): boolean {
	if (source === "system") return systemDark;
	return source === "dark";
}

export function resolveColorScheme(source: ThemeSource, systemDark: boolean): ResolvedColorScheme {
	return resolveShouldUseDarkColors(source, systemDark) ? "dark" : "light";
}

export function chromeFor(
	shouldUseDarkColors: boolean,
	colors: Record<ResolvedColorScheme, ThemeChromeColors> = themeChromeColors,
): ThemeChromeColors {
	return shouldUseDarkColors ? colors.dark : colors.light;
}

/**
 * Platforms where the OS draws a frosted material behind the window.
 * Elsewhere Electron paints an opaque chrome color under a transparent page.
 */
export function usesSystemWindowMaterial(platform: string): boolean {
	return platform === "darwin";
}

export function windowBackgroundFor(
	shouldUseDarkColors: boolean,
	platform: string,
	colors: Record<ResolvedColorScheme, ThemeChromeColors> = themeChromeColors,
): string {
	if (usesSystemWindowMaterial(platform)) return TRANSPARENT_WINDOW_BACKGROUND;
	return chromeFor(shouldUseDarkColors, colors).background;
}

/**
 * Critical first-paint CSS — injected into index.html by the Vite plugin.
 * Matches the loaded shell glass tint so CMD+R / cold start don't flash a
 * different base color before React mounts. Tint only `html` — painting
 * `body` too would stack two translucent layers and look too opaque.
 */
export function criticalThemeStyle(): string {
	return [
		`html{background:color-mix(in srgb,var(--sidebar,#f9fbfb) var(--shell-glass-opacity,${shellGlassOpacity.light}%),transparent)}`,
		`html[data-theme="dark"]{background:color-mix(in srgb,var(--sidebar,${shellGlassDarkSurface}) var(--shell-glass-opacity,${shellGlassOpacity.dark}%),transparent)}`,
		"body{background:transparent}",
	].join("");
}

/**
 * Pre-paint bootstrap IIFE — injected into index.html by the Vite plugin.
 * Mirrors readStoredThemeSource / resolveColorScheme / applyDocumentColorScheme.
 * Build-time CSS registries recover saved selections without importing the theme model here.
 */
export function themeBootstrapScript(
	defaultThemeId: string,
	themeCssById: Record<string, string>,
	accentCssById: Record<string, string>,
): string {
	const key = JSON.stringify(THEME_STORAGE_KEY);
	const defaultSource = JSON.stringify(DEFAULT_THEME_SOURCE);
	const appThemeKey = JSON.stringify(APP_THEME_STORAGE_KEY);
	const vibrancyKey = JSON.stringify(SIDEBAR_VIBRANCY_STORAGE_KEY);
	const textSizeKey = JSON.stringify(TEXT_SIZE_STORAGE_KEY);
	// Mirrors normalizeTextSizes.
	const textSizeModel = JSON.stringify({
		vars: TEXT_SIZE_CSS_VARS,
		range: TEXT_SIZE_RANGE,
		defaults: DEFAULT_TEXT_SIZES,
	});
	return [
		`(function(){var k=${key},s=${defaultSource},r=document.documentElement;try{if(localStorage.getItem(${vibrancyKey})==="false")r.style.setProperty("--shell-glass-opacity","100%");var v=localStorage.getItem(k);if(v==="light"||v==="dark"||v==="system")s=v}catch(e){}var d=s==="dark"||(s==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)r.dataset.theme="dark";else delete r.dataset.theme;r.style.colorScheme=d?"dark":"light";`,
		`try{var z=localStorage.getItem(${textSizeKey});if(z){var q=JSON.parse(z),m=${textSizeModel};if(q&&typeof q==="object"&&!Array.isArray(q))for(var t in m.vars){var n=q[t];n=typeof n==="number"&&isFinite(n)?Math.min(m.range.max,Math.max(m.range.min,Math.round(n))):m.defaults[t];r.style.setProperty(m.vars[t],n+"px")}}}catch(e){}`,
		`var themes=${JSON.stringify(themeCssById)},accents=${JSON.stringify(accentCssById)},c=themes[${JSON.stringify(defaultThemeId)}]||"";try{var p=JSON.parse(localStorage.getItem(${appThemeKey}));if(p&&typeof p==="object"&&!Array.isArray(p)){if(typeof p.themeId==="string"&&Object.hasOwn(themes,p.themeId))c=themes[p.themeId];if(typeof p.accentId==="string"&&Object.hasOwn(accents,p.accentId))c+=accents[p.accentId]}}catch(e){}`,
		`if(c){var t=document.getElementById("app-theme");if(!t){t=document.createElement("style");t.id="app-theme";document.head.appendChild(t)}t.textContent=c}})();`,
	].join("");
}
