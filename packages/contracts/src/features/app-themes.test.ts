import { describe, expect, it } from "vitest";

import {
	APP_THEMES,
	DEFAULT_APP_THEME_PREFERENCES,
	getThemeAppearance,
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
		expect(getThemeVariant("anaconda", "light")?.tokens).toBeNull();
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

	it("projects Kilo and Anaconda into complete surface appearances", () => {
		const kiloLight = getThemeAppearance({ themeId: "kilo" }, "light");
		const kiloDark = getThemeAppearance({ themeId: "kilo" }, "dark");
		expect(kiloLight.shiki).toBe("github-light");
		expect(kiloDark.shiki).toBe("github-dark");
		expect(Object.keys(kiloDark.terminal ?? {})).toHaveLength(22);
		expect(kiloDark.terminal).toMatchObject({
			black: "#303030",
			red: "#ffe4e6",
			brightWhite: "#fafafa",
		});
		expect(themeCss({ themeId: "kilo" })).toContain("--chat-ambient-glow:#f7f586;");
		const anacondaLight = getThemeAppearance({ themeId: "anaconda" }, "light");
		const anacondaDark = getThemeAppearance({ themeId: "anaconda" }, "dark");
		expect(anacondaLight.shiki).toBe("pierre-light");
		expect(anacondaDark.shiki).toBe("pierre-dark");
		expect(Object.keys(anacondaDark.terminal ?? {})).toHaveLength(22);
		expect(anacondaLight.terminal).toMatchObject({
			background: "#ffffff",
			foreground: "#090b0c",
			green: "#07ca4a",
		});
		expect(anacondaDark.terminal).toMatchObject({
			background: "#101314",
			foreground: "#f9fbfb",
			green: "#96f778",
		});
	});
});
