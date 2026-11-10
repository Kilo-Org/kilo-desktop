import { describe, expect, it } from "vitest";

import {
	accentCss,
	ACCENT_ROLE_DEFAULTS,
	ACCENTS,
	APP_THEMES,
	DEFAULT_APP_THEME_PREFERENCES,
	getThemeAppearance,
	getThemeChrome,
	getThemeVariant,
	normalizeAppThemePreferences,
	themeCss,
} from "./app-themes.js";

function luminance(hex: string): number {
	const channels = hex
		.slice(1)
		.match(/../g)!
		.map((channel) => {
			const value = Number.parseInt(channel, 16) / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
	return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(text: string, background: string): number {
	const a = luminance(text);
	const b = luminance(background);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** CIE L* (0–100); unlike the WCAG ratio it is perceptually even across light and dark. */
function lightness(hex: string): number {
	const y = luminance(hex);
	const f = y > (6 / 29) ** 3 ? Math.cbrt(y) : (y * (29 / 6) ** 2) / 3 + 4 / 29;
	return 116 * f - 16;
}

/**
 * Themes built from a role palette. Anaconda states the design system's token
 * table verbatim, so the derivation rules checked here do not apply to it.
 */
const DERIVED_THEMES = APP_THEMES.filter(({ id }) => id !== "anaconda");

describe("app theme presets", () => {
	it("provides Anaconda and complete paired palettes", () => {
		expect(APP_THEMES.map(({ id }) => id)).toEqual([
			"kilo",
			"anaconda",
			"dracula",
			"catppuccin",
			"gruvbox",
			"github",
			"everforest",
			"nord",
		]);
		expect(APP_THEMES[0]!.name).toBe("Kilo");
		expect(getThemeVariant("kilo", "light")?.tokens).toMatchObject({
			sidebar: "#f4f4f4",
			muted: "#f5f5f5",
			border: "#e5e5e5",
			primary: "#0a0a0a",
			"primary-foreground": "#ffffff",
			ring: "#737373",
		});
		expect(getThemeVariant("kilo", "dark")?.tokens).toMatchObject({
			background: "#111111",
			foreground: "#d4d4d4",
			border: "rgb(255 255 255 / 0.1)",
			input: "rgb(255 255 255 / 0.1)",
			primary: "#ededed",
			"primary-foreground": "#111111",
			ring: "#a3a3a3",
			card: "#181818",
			popover: "#2b2b2b",
			sidebar: "#0e0e0e",
			"sidebar-border": "rgb(255 255 255 / 0.1)",
			muted: "#333333",
			accent: "color-mix(in oklch, var(--foreground) 5%, transparent)",
			secondary: "color-mix(in oklch, var(--foreground) 5%, transparent)",
		});
		const kiloCss = themeCss({ themeId: "kilo", accentId: "theme" });
		expect(kiloCss).not.toContain("--shell-glass-opacity");
		const dark = getThemeVariant("dracula", "dark")!;
		expect(dark.tokens?.background).toBe("#282a36");
		expect(dark.tokens?.sidebar).toBe(dark.tokens?.background);
		expect(dark.tokens).not.toHaveProperty("sidebar-accent");
		expect(dark.tokens?.["state-tint"]).toBe("#bd93f9");
		expect(getThemeVariant("kilo", "dark")?.tokens).not.toHaveProperty("state-tint");
		expect(Object.keys(dark.terminal ?? {})).toHaveLength(22);
	});

	it("defaults to Kilo while preserving explicit Anaconda and other theme selections", () => {
		expect(DEFAULT_APP_THEME_PREFERENCES).toEqual({ themeId: "kilo", accentId: "theme" });
		for (const input of [null, [], "dracula", 12, { themeId: "unknown", accentId: "</style>" }]) {
			expect(normalizeAppThemePreferences(input)).toEqual(DEFAULT_APP_THEME_PREFERENCES);
		}
		expect(normalizeAppThemePreferences({ themeId: "dracula", accentId: "unknown" })).toEqual({
			themeId: "dracula",
			accentId: "theme",
		});
		const anaconda = { themeId: "anaconda", accentId: "theme" };
		expect(normalizeAppThemePreferences(anaconda)).toEqual(anaconda);
		expect(themeCss(DEFAULT_APP_THEME_PREFERENCES)).toContain("--background:#111111;");
		expect(themeCss({ themeId: "bad;}html{", accentId: "bad" })).toBe(
			themeCss(DEFAULT_APP_THEME_PREFERENCES),
		);
		expect(getThemeVariant("unknown", "dark")).toBe(getThemeVariant("kilo", "dark"));
		expect(getThemeChrome("unknown")).toEqual(getThemeChrome("kilo"));
	});

	it("derives native chrome for Kilo and Anaconda", () => {
		expect(getThemeChrome("kilo")).toEqual({
			light: { background: "#ffffff", foreground: "#0a0a0a" },
			dark: { background: "#111111", foreground: "#d4d4d4" },
		});
		expect(getThemeChrome("anaconda")).toEqual({
			light: { background: "#ffffff", foreground: "#090b0c" },
			dark: { background: "#101314", foreground: "#d0d6d8" },
		});
	});

	it("projects Kilo, Anaconda, and catalog themes into complete surface appearances", () => {
		const kiloLight = getThemeAppearance({ themeId: "kilo", accentId: "theme" }, "light");
		const kiloDark = getThemeAppearance({ themeId: "kilo", accentId: "theme" }, "dark");
		expect(kiloLight.shiki).toBe("github-light");
		expect(kiloDark.shiki).toBe("github-dark");
		expect(Object.keys(kiloDark.terminal ?? {})).toHaveLength(22);
		expect(kiloDark.terminal).toMatchObject({
			black: "#111111",
			red: "#f87171",
			brightWhite: "#fafafa",
		});
		const anaconda = { themeId: "anaconda", accentId: "theme" };
		const anacondaLight = getThemeAppearance(anaconda, "light");
		const anacondaDark = getThemeAppearance(anaconda, "dark");
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
		const preferences = { themeId: "dracula", accentId: "theme" };
		const css = themeCss(preferences);
		expect(css).toContain("html:root{--background:#f8f7fc;");
		expect(css).toContain('html:root[data-theme="dark"]{--background:#282a36;');
		expect(css).not.toContain("--font");
		expect(getThemeChrome(preferences.themeId).dark).toEqual({
			background: "#282a36",
			foreground: "#f8f8f2",
		});
		expect(getThemeAppearance(preferences, "dark")).toMatchObject({
			mode: "dark",
			themeId: "dracula",
			shiki: "dracula",
			terminal: { background: "#282a36", brightRed: "#ff6e6e" },
		});
	});

	it("every derived variant aliases the accent", () => {
		for (const theme of DERIVED_THEMES) {
			for (const mode of ["light", "dark"] as const) {
				expect(getThemeVariant(theme.id, mode).tokens).toMatchObject(ACCENT_ROLE_DEFAULTS);
			}
		}
	});

	it("restores accent-role defaults when a curated accent replaces Kilo yellow", () => {
		const light = themeCss({ themeId: "kilo", accentId: "blue" }).split(
			'html:root[data-theme="dark"]',
		)[0]!;
		expect(light).toContain("--primary-ink:var(--primary);");
		expect(light).toContain("--primary-soft-foreground:var(--primary);");
	});

	it("layers curated accents over any theme without recoloring terminal", () => {
		expect(ACCENTS.map(({ id }) => id)).toEqual([
			"theme",
			"blue",
			"purple",
			"pink",
			"red",
			"orange",
			"green",
		]);
		expect(normalizeAppThemePreferences({ themeId: "dracula" })).toEqual({
			themeId: "dracula",
			accentId: "theme",
		});
		expect(normalizeAppThemePreferences({ accentId: "blue" })).toEqual({
			themeId: "kilo",
			accentId: "blue",
		});
		const preferences = { themeId: "anaconda", accentId: "blue" };
		const css = themeCss(preferences);
		expect(css).toContain("--primary:#1d4ed8;");
		expect(css).toContain("--primary-foreground:#ffffff;");
		expect(css).toContain("--sidebar-primary:#1d4ed8;");
		expect(css).toContain("--ring:#1d4ed8;");
		expect(css).toContain("--primary:#93c5fd;");
		expect(getThemeAppearance(preferences, "dark")).toEqual(
			getThemeAppearance({ ...preferences, accentId: "theme" }, "dark"),
		);
	});

	it("emits full light and dark surfaces for every theme, Anaconda included", () => {
		for (const { id } of APP_THEMES) {
			const css = themeCss({ themeId: id, accentId: "theme" });
			for (const mode of ["light", "dark"] as const) {
				expect(css).toContain(`--background:${getThemeVariant(id, mode).tokens.background};`);
			}
		}
	});

	// The pre-paint bootstrap appends accent CSS after the saved theme's CSS, so
	// restating a surface here would repaint every theme with Kilo's.
	it("emits only accent overrides from accentCss", () => {
		expect(accentCss("theme")).toBe("");
		for (const { id } of ACCENTS.filter(({ id }) => id !== "theme")) {
			const css = accentCss(id);
			expect(css).toContain("--primary:");
			expect(css).not.toContain("--background:");
			expect(css).not.toContain("--foreground:");
		}
	});

	it("keeps semantic and accent text readable on content surfaces and tinted controls", () => {
		for (const theme of DERIVED_THEMES) {
			for (const mode of ["light", "dark"] as const) {
				const { tokens } = theme.variants[mode];
				for (const surface of ["background", "card", "popover"] as const) {
					for (const role of [
						"foreground",
						"muted-foreground",
						"destructive",
						"destructive-foreground",
						"info",
						"info-foreground",
						"success",
						"success-foreground",
						"warning",
						"warning-foreground",
						"update",
					] as const) {
						expect(
							contrast(tokens[role], tokens[surface]),
							`${theme.id} ${mode} ${role} on ${surface}`,
						).toBeGreaterThanOrEqual(4.5);
					}
					for (const role of ["destructive", "info", "success", "warning"] as const) {
						// Buttons/badges tint the underlying surface by 10%, then 20% on hover.
						for (const opacity of [0.1, 0.2]) {
							const tinted =
								"#" +
								[1, 3, 5]
									.map((start) =>
										Math.round(
											Number.parseInt(tokens[role].slice(start, start + 2), 16) * opacity +
												Number.parseInt(tokens[surface].slice(start, start + 2), 16) *
													(1 - opacity),
										)
											.toString(16)
											.padStart(2, "0"),
									)
									.join("");
							expect(
								contrast(tokens[`${role}-foreground`], tinted),
								`${theme.id} ${mode} ${role} on ${surface} at ${opacity}`,
							).toBeGreaterThanOrEqual(4.5);
						}
					}
				}
				for (const surface of ["update-surface", "update-surface-hover"] as const) {
					if (!/^#[0-9a-f]{6}$/i.test(tokens[surface])) continue;
					expect(
						contrast(tokens.update, tokens[surface]),
						`${theme.id} ${mode} update on ${surface}`,
					).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
		expect(getThemeVariant("gruvbox", "dark")?.terminal?.red).toBe("#cc241d");
		expect(getThemeVariant("everforest", "light")?.terminal?.red).toBe("#f85552");
		for (const accent of ACCENTS.slice(1)) {
			for (const mode of ["light", "dark"] as const) {
				const { color, foreground } = accent[mode];
				for (const background of [
					foreground,
					...APP_THEMES.map((theme) => getThemeChrome(theme.id)[mode].background),
				]) {
					expect(color).toMatch(/^#[0-9a-f]{6}$/);
					expect(background).toMatch(/^#[0-9a-f]{6}$/);
					expect(
						contrast(color, background),
						`${accent.id} ${mode} on ${background}`,
					).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
	});

	it("gives every terminal palette a selection highlight that separates from its background", () => {
		// 30% foreground over #111111 for Kilo dark; the former hover tint (#1b1b1b) vanished on the pane.
		expect(getThemeVariant("kilo", "dark")?.terminal?.selectionBackground).toBe("#4c4c4c");
		expect(getThemeVariant("kilo", "light")?.terminal?.selectionBackground).toBe("#b6b6b6");
		for (const theme of APP_THEMES) {
			for (const mode of ["light", "dark"] as const) {
				const { terminal } = theme.variants[mode];
				expect(
					Math.abs(lightness(terminal.selectionBackground) - lightness(terminal.background)),
					`${theme.id} ${mode} selection on terminal background`,
				).toBeGreaterThanOrEqual(15);
				// WCAG large-text / non-text floor. Everforest is a low-contrast palette
				// by design (fg/bg 5.2:1 light) and sits at 3.5:1 here; the rest clear 4.4:1.
				expect(
					contrast(terminal.selectionForeground, terminal.selectionBackground),
					`${theme.id} ${mode} selected text`,
				).toBeGreaterThanOrEqual(3);
			}
		}
	});
});
