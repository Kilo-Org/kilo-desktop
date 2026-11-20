import { describe, expect, it } from "vitest";

import {
	readingSurfaceTheme,
	readingThemeStyle,
	readingThemeSwatches,
	resolveReadingTheme,
} from "./reading-theme";
import { DEFAULT_READING_SETTINGS } from "./settings";

describe("reading theme", () => {
	const app = { themeId: "kilo", mode: "dark" as const };

	it("follows the app's theme and mode by default", () => {
		expect(resolveReadingTheme(DEFAULT_READING_SETTINGS, app)).toEqual({
			themeId: "kilo",
			mode: "dark",
			applied: false,
		});
	});

	it("uses the chosen theme, and the app's mode on Auto", () => {
		const gruvbox = { ...DEFAULT_READING_SETTINGS, themeId: "gruvbox" as const };

		expect(resolveReadingTheme(gruvbox, app)).toEqual({
			themeId: "gruvbox",
			mode: "dark",
			applied: true,
		});
		expect(resolveReadingTheme({ ...gruvbox, mode: "light" }, app)).toEqual({
			themeId: "gruvbox",
			mode: "light",
			applied: true,
		});
		expect(resolveReadingTheme({ ...DEFAULT_READING_SETTINGS, mode: "light" }, app).applied).toBe(
			true,
		);
	});

	it("styles a subtree with the theme's tokens, scheme and the roles derived from them", () => {
		const style = readingThemeStyle("gruvbox", "light");

		expect(style.attributes).toEqual({ "data-theme": "light" });
		expect(style.style.colorScheme).toBe("light");
		expect(style.style["--background" as never]).toBe("#fbf1c7");
		expect(style.style["--foreground" as never]).toBe("#3c3836");
		expect(style.style["--state-hover" as never]).toContain("var(--state-tint)");
		expect(style.style["--pane-surface" as never]).toBe("var(--background)");
		expect(style.shiki).toBe("gruvbox-light-medium");
	});

	it("scopes a reading surface to the reading theme, with its background and text colour, only when it differs from the app's", () => {
		expect(readingSurfaceTheme(DEFAULT_READING_SETTINGS, app)).toBeNull();

		const scope = readingSurfaceTheme(
			{ ...DEFAULT_READING_SETTINGS, themeId: "gruvbox", mode: "light" },
			app,
		)!;

		expect(scope.attributes).toEqual({ "data-theme": "light" });
		expect(scope.style["--background" as never]).toBe("#fbf1c7");
		expect(scope.style.backgroundColor).toBe("var(--background)");
		expect(scope.style.color).toBe("var(--foreground)");
	});

	it("offers one swatch per Appearance theme: background with an accent dot", () => {
		const swatches = readingThemeSwatches("dark");

		expect(swatches.map((swatch) => swatch.name)).toEqual([
			"Kilo",
			"Anaconda",
			"Dracula",
			"Catppuccin",
			"Gruvbox",
			"GitHub",
			"Everforest",
			"Nord",
		]);
		expect(swatches[0]).toMatchObject({ id: "kilo", background: expect.any(String) });
		expect(swatches[0]!.accent).toBeTruthy();
	});
});
