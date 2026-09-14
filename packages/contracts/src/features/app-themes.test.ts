import { describe, expect, it } from "vitest";

import {
	APP_THEMES,
	DEFAULT_APP_THEME_PREFERENCES,
	getThemeChrome,
	getThemeVariant,
	normalizeAppThemePreferences,
	themeCss,
} from "./app-themes.js";

describe("app theme presets", () => {
	it("provides Kilo first and Anaconda second", () => {
		expect(APP_THEMES.map(({ id }) => id)).toEqual(["kilo", "anaconda"]);
		expect(APP_THEMES.map(({ name }) => name)).toEqual(["Kilo", "Anaconda"]);
		expect(getThemeVariant("kilo", "dark")?.tokens).toMatchObject({
			background: "#111111",
			foreground: "#fafafa",
			primary: "#f7f586",
			"primary-foreground": "#1f1f1f",
			card: "#1f1f1f",
			popover: "#2b2b2b",
			sidebar: "#161616",
		});
		const kiloCss = themeCss({ themeId: "kilo" }).split("}");
		expect(kiloCss[0]).not.toContain("--shell-glass-opacity");
		expect(kiloCss[1]).toContain("--shell-glass-opacity:96%;");
	});

	it("defaults invalid preferences to Kilo and preserves Anaconda", () => {
		expect(DEFAULT_APP_THEME_PREFERENCES).toEqual({ themeId: "kilo" });
		for (const input of [null, [], "anaconda", 12, { themeId: "unknown" }]) {
			expect(normalizeAppThemePreferences(input)).toEqual(DEFAULT_APP_THEME_PREFERENCES);
		}
		const anaconda = { themeId: "anaconda" };
		expect(normalizeAppThemePreferences(anaconda)).toEqual(anaconda);
		expect(themeCss(anaconda)).toBe("");
		expect(themeCss(DEFAULT_APP_THEME_PREFERENCES)).toContain("--background:#111111;");
		expect(themeCss({ themeId: "bad;}html{" })).toBe(themeCss(DEFAULT_APP_THEME_PREFERENCES));
		expect(getThemeVariant("anaconda", "light")).toBeNull();
		expect(getThemeVariant("unknown", "dark")).toBe(getThemeVariant("kilo", "dark"));
		expect(getThemeChrome("unknown")).toEqual(getThemeChrome("kilo"));
	});

	it("derives native chrome for Kilo and Anaconda", () => {
		expect(getThemeChrome("kilo")).toEqual({
			light: { background: "#fafaf7", foreground: "#1f1f1f" },
			dark: { background: "#111111", foreground: "#fafafa" },
		});
		expect(getThemeChrome("anaconda")).toEqual({
			light: { background: "#ffffff", foreground: "#090b0c" },
			dark: { background: "#101314", foreground: "#f9fbfb" },
		});
	});
});
