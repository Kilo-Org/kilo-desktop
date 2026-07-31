import { describe, expect, it, vi } from "vitest";

import { createThemeHandlers, restoreNativeThemeFromPreferences } from "./handlers.js";

describe("createThemeHandlers", () => {
	it("persists source, applies nativeTheme, and repaints chrome on sync", () => {
		const electronWindow = { applyColorScheme: vi.fn() };
		const preferences = { setThemeSource: vi.fn() };
		const theme = { themeSource: "system" as "system" | "light" | "dark" };

		const handlers = createThemeHandlers(electronWindow as never, preferences as never, theme);

		expect(handlers["theme:sync"]({ source: "dark", shouldUseDarkColors: true })).toBeUndefined();

		expect(preferences.setThemeSource).toHaveBeenCalledWith("dark");
		expect(theme.themeSource).toBe("dark");
		expect(electronWindow.applyColorScheme).toHaveBeenCalledWith(true);
	});

	it("persists system so cold start can re-resolve against the live OS scheme", () => {
		const electronWindow = { applyColorScheme: vi.fn() };
		const preferences = { setThemeSource: vi.fn() };
		const theme = { themeSource: "dark" as "system" | "light" | "dark" };

		const handlers = createThemeHandlers(electronWindow as never, preferences as never, theme);

		handlers["theme:sync"]({ source: "system", shouldUseDarkColors: false });

		expect(preferences.setThemeSource).toHaveBeenCalledWith("system");
		expect(theme.themeSource).toBe("system");
		expect(electronWindow.applyColorScheme).toHaveBeenCalledWith(false);
	});
});

describe("restoreNativeThemeFromPreferences", () => {
	it("mirrors a forced dark preference onto nativeTheme before windows exist", () => {
		const preferences = { themeSource: "dark" as const };
		let themeSource: "system" | "light" | "dark" = "system";
		const theme = {
			get themeSource() {
				return themeSource;
			},
			set themeSource(next: "system" | "light" | "dark") {
				themeSource = next;
			},
			get shouldUseDarkColors() {
				return themeSource === "dark";
			},
		};

		const state = restoreNativeThemeFromPreferences(preferences as never, theme);
		expect(theme.themeSource).toBe("dark");
		expect(state).toEqual({ source: "dark", shouldUseDarkColors: true });
	});

	it("defaults to system when no preference is stored", () => {
		const preferences = { themeSource: undefined };
		let themeSource: "system" | "light" | "dark" = "light";
		const theme = {
			get themeSource() {
				return themeSource;
			},
			set themeSource(next: "system" | "light" | "dark") {
				themeSource = next;
			},
			get shouldUseDarkColors() {
				return themeSource !== "light";
			},
		};

		const state = restoreNativeThemeFromPreferences(preferences as never, theme);
		expect(theme.themeSource).toBe("system");
		expect(state.source).toBe("system");
		expect(state.shouldUseDarkColors).toBe(true);
	});
});
