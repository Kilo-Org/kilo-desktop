import { describe, expect, it, vi } from "vitest";

import { createThemeHandlers, restoreNativeThemeFromPreferences } from "./handlers.js";

describe("createThemeHandlers", () => {
	it("persists source, applies nativeTheme, and repaints chrome on sync", () => {
		const electronWindow = { applyColorScheme: vi.fn() };
		const preferences = { setThemeSource: vi.fn(), setThemeId: vi.fn() };
		const theme = { themeSource: "system" as "system" | "light" | "dark" };

		const handlers = createThemeHandlers(electronWindow as never, preferences as never, theme);

		expect(handlers["theme:sync"]({ source: "dark", themeId: "dracula" })).toBeUndefined();

		expect(preferences.setThemeSource).toHaveBeenCalledWith("dark");
		expect(preferences.setThemeId).toHaveBeenCalledWith("dracula");
		expect(theme.themeSource).toBe("dark");
		expect(electronWindow.applyColorScheme).toHaveBeenCalledWith();
	});

	it("persists system so cold start can re-resolve against the live OS scheme", () => {
		const electronWindow = { applyColorScheme: vi.fn() };
		const preferences = { setThemeSource: vi.fn(), setThemeId: vi.fn() };
		const theme = { themeSource: "dark" as "system" | "light" | "dark" };

		const handlers = createThemeHandlers(electronWindow as never, preferences as never, theme);

		handlers["theme:sync"]({ source: "system", themeId: "kilo" });

		expect(preferences.setThemeSource).toHaveBeenCalledWith("system");
		expect(theme.themeSource).toBe("system");
		expect(electronWindow.applyColorScheme).toHaveBeenCalledWith();
	});
});

describe("restoreNativeThemeFromPreferences", () => {
	it("mirrors a forced dark preference onto nativeTheme before windows exist", () => {
		const preferences = { themeSource: "dark" as const };
		const theme = { themeSource: "system" as "system" | "light" | "dark" };

		restoreNativeThemeFromPreferences(preferences as never, theme);
		expect(theme.themeSource).toBe("dark");
	});

	it("defaults to system when no preference is stored", () => {
		const preferences = { themeSource: undefined };
		const theme = { themeSource: "light" as "system" | "light" | "dark" };

		restoreNativeThemeFromPreferences(preferences as never, theme);
		expect(theme.themeSource).toBe("system");
	});
});
