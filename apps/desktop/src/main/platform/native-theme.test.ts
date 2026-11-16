import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ nativeTheme: { themeSource: "system" } }));

import { EventEmitter } from "node:events";

import {
	repaintOnSystemColorSchemeChange,
	restoreNativeThemeFromPreferences,
} from "./native-theme.js";

describe("repaintOnSystemColorSchemeChange", () => {
	// Linux reports the system scheme (GTK / xdg-desktop-portal) after windows
	// exist, and any OS can switch while running; native chrome must follow.
	it("repaints window chrome each time the system colour scheme changes", () => {
		const theme = new EventEmitter();
		const windows = { applyColorScheme: vi.fn() };

		repaintOnSystemColorSchemeChange(windows, theme as never);
		theme.emit("updated");
		theme.emit("updated");

		expect(windows.applyColorScheme).toHaveBeenCalledTimes(2);
	});

	it("stops repainting once disposed", () => {
		const theme = new EventEmitter();
		const windows = { applyColorScheme: vi.fn() };

		const dispose = repaintOnSystemColorSchemeChange(windows, theme as never);
		dispose();
		theme.emit("updated");

		expect(windows.applyColorScheme).not.toHaveBeenCalled();
	});
});

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
