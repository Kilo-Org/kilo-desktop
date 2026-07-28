import { describe, expect, it, vi } from "vitest";

import { createThemeHandlers } from "./handlers.js";

describe("createThemeHandlers", () => {
	it("persists theme source through preferences on set", () => {
		const electronTheme = {
			state: { source: "system" as const, shouldUseDarkColors: true },
			setSource: vi.fn((source: "system" | "light" | "dark") => ({
				source,
				shouldUseDarkColors: source !== "light",
			})),
		};
		const preferences = {
			setThemeSource: vi.fn(),
		};

		const handlers = createThemeHandlers(electronTheme as never, preferences as never);
		const result = handlers["theme:set"]({ source: "dark" });

		expect(preferences.setThemeSource).toHaveBeenCalledWith("dark");
		expect(electronTheme.setSource).toHaveBeenCalledWith("dark");
		expect(result).toEqual({ source: "dark", shouldUseDarkColors: true });
	});
});
