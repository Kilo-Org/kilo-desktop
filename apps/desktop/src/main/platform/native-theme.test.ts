import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ nativeTheme: { themeSource: "system" } }));

import { restoreNativeThemeFromPreferences } from "./native-theme.js";

describe("restoreNativeThemeFromPreferences", () => {
	it("mirrors a forced dark preference onto nativeTheme before windows exist", () => {
		const preferences = { themeSource: "dark" as const };
		const theme = { themeSource: "system" as "system" | "light" | "dark" };

		restoreNativeThemeFromPreferences(preferences as never, theme);
		expect(theme.themeSource).toBe("dark");
	});

	it("defaults to dark when no preference is stored", () => {
		const preferences = { themeSource: undefined };
		const theme = { themeSource: "light" as "system" | "light" | "dark" };

		restoreNativeThemeFromPreferences(preferences as never, theme);
		expect(theme.themeSource).toBe("dark");
	});
});
