import { describe, expect, it } from "vitest";

import {
	chromeFor,
	criticalThemeStyle,
	resolveColorScheme,
	resolveShouldUseDarkColors,
	THEME_STORAGE_KEY,
	THEME_SOURCES,
	themeSourceSchema,
	themeBootstrapScript,
	themeChromeColors,
	TRANSPARENT_WINDOW_BACKGROUND,
	shellGlassDarkSurface,
	shellGlassOpacity,
	usesSystemWindowMaterial,
	windowBackgroundFor,
} from "./theme.js";

describe("theme contracts", () => {
	it("resolves explicit and system sources", () => {
		expect(themeSourceSchema.options).toEqual(THEME_SOURCES);
		expect(resolveShouldUseDarkColors("dark", false)).toBe(true);
		expect(resolveShouldUseDarkColors("light", true)).toBe(false);
		expect(resolveShouldUseDarkColors("system", true)).toBe(true);
		expect(resolveShouldUseDarkColors("system", false)).toBe(false);
		expect(resolveColorScheme("system", true)).toBe("dark");
		expect(resolveColorScheme("light", true)).toBe("light");
	});

	it("selects chrome paint tokens", () => {
		expect(chromeFor(false)).toEqual(themeChromeColors.light);
		expect(chromeFor(true)).toEqual(themeChromeColors.dark);
	});

	it("uses transparent window paint on platforms with system materials", () => {
		expect(usesSystemWindowMaterial("darwin")).toBe(true);
		expect(usesSystemWindowMaterial("win32")).toBe(false);
		expect(usesSystemWindowMaterial("linux")).toBe(false);
		expect(windowBackgroundFor(true, "darwin")).toBe(TRANSPARENT_WINDOW_BACKGROUND);
		expect(windowBackgroundFor(false, "win32")).toBe(themeChromeColors.light.background);
		expect(windowBackgroundFor(true, "linux")).toBe(themeChromeColors.dark.background);
	});

	it("builds critical CSS and bootstrap script from the shared tokens", () => {
		const css = criticalThemeStyle();
		expect(css).toContain("var(--sidebar,");
		expect(css).toContain(shellGlassDarkSurface);
		expect(css).toContain(`var(--shell-glass-opacity,${shellGlassOpacity.light}%)`);
		expect(css).toContain(`var(--shell-glass-opacity,${shellGlassOpacity.dark}%)`);
		expect(css).toContain('html[data-theme="dark"]');

		const script = themeBootstrapScript();
		expect(script).toContain(THEME_STORAGE_KEY);
		expect(script).toContain("dataset.theme");
		expect(script).toContain("prefers-color-scheme");
	});
});
