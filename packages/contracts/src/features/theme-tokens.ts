export const THEME_SOURCES = ["system", "light", "dark"] as const;
export type ThemeSource = (typeof THEME_SOURCES)[number];
export type ResolvedColorScheme = "light" | "dark";

/** localStorage key for the renderer-owned theme source (and the pre-paint bootstrap). */
export const THEME_STORAGE_KEY = "theme:v1";

/**
 * Hex paint tokens for native chrome (Linux window background, splash, title-bar symbols).
 * Hex equivalents of the background/foreground values from
 * `@anaconda/shadcn-theme` — Electron cannot use oklch here.
 * macOS uses a transparent window over vibrancy instead.
 */
export const themeChromeColors = {
	light: { background: "#ffffff", foreground: "#090b0c" },
	dark: { background: "#161b1d", foreground: "#f9fbfb" },
} as const;

export type ThemeChromeColors = (typeof themeChromeColors)[keyof typeof themeChromeColors];

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
 * Dark shell surface hex: Mist 950 — keep in sync with
 * `--sidebar` / the html glass tint in apps/web globals.css. Distinct from
 * `themeChromeColors.dark.background` (Mist 900), which paints content panes.
 */
export const shellGlassDarkSurface = "#090b0c";

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

/**
 * Platforms where the OS draws a frosted material behind the window.
 * Elsewhere Electron paints an opaque chrome color under a transparent page.
 */
export function usesSystemWindowMaterial(platform: NodeJS.Platform = process.platform): boolean {
	return platform === "darwin";
}

export function windowBackgroundFor(
	shouldUseDarkColors: boolean,
	platform: NodeJS.Platform = process.platform,
): string {
	if (usesSystemWindowMaterial(platform)) return TRANSPARENT_WINDOW_BACKGROUND;
	return chromeFor(shouldUseDarkColors).background;
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
 */
export function themeBootstrapScript(): string {
	const key = JSON.stringify(THEME_STORAGE_KEY);
	return `(function(){var k=${key},s="system";try{var v=localStorage.getItem(k);if(v==="light"||v==="dark"||v==="system")s=v}catch(e){}var d=s==="dark"||(s==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.dataset.theme="dark";else delete r.dataset.theme;r.style.colorScheme=d?"dark":"light"})();`;
}
