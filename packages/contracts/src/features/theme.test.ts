import { describe, expect, it } from "vitest";

import {
	chromeFor,
	criticalThemeStyle,
	resolveColorScheme,
	resolveShouldUseDarkColors,
	THEME_STORAGE_KEY,
	themeBootstrapScript,
	themeChromeColors,
} from "./theme.js";

describe("theme contracts", () => {
	it("resolves explicit and system sources", () => {
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

	it("builds critical CSS and bootstrap script from the shared tokens", () => {
		const css = criticalThemeStyle();
		expect(css).toContain(themeChromeColors.light.background);
		expect(css).toContain(themeChromeColors.dark.background);
		expect(css).toContain('html[data-theme="dark"]');

		const script = themeBootstrapScript();
		expect(script).toContain(THEME_STORAGE_KEY);
		expect(script).toContain("dataset.theme");
		expect(script).toContain("prefers-color-scheme");
	});
});
