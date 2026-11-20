import { describe, expect, it } from "vitest";

import {
	DEFAULT_READING_SETTINGS,
	isDefaultReadingSettings,
	normalizeReadingSettings,
} from "./settings";

describe("reading settings", () => {
	it("defaults to the app theme, size step 0, the second spacing, scrolling and 60% dimming", () => {
		expect(DEFAULT_READING_SETTINGS).toEqual({
			themeId: null,
			mode: "auto",
			textSizeStep: 0,
			lineSpacing: 1,
			focus: { movesWith: "scroll", dimming: 60 },
		});
	});

	it("keeps valid values and replaces anything else with the default", () => {
		expect(
			normalizeReadingSettings({
				themeId: "gruvbox",
				mode: "light",
				textSizeStep: 3,
				lineSpacing: 3,
				focus: { movesWith: "keys", dimming: 85 },
			}),
		).toEqual({
			themeId: "gruvbox",
			mode: "light",
			textSizeStep: 3,
			lineSpacing: 3,
			focus: { movesWith: "keys", dimming: 85 },
		});
		expect(
			normalizeReadingSettings({
				themeId: "solarized",
				mode: "sepia",
				textSizeStep: 2.5,
				lineSpacing: 7,
				focus: { movesWith: "eyes", dimming: "lots" },
			}),
		).toEqual(DEFAULT_READING_SETTINGS);
		expect(normalizeReadingSettings(null)).toEqual(DEFAULT_READING_SETTINGS);
	});

	it("clamps the size step to -2…+6 and dimming to 0–100", () => {
		const clamped = normalizeReadingSettings({ textSizeStep: 40, focus: { dimming: -5 } });
		expect(clamped.textSizeStep).toBe(6);
		expect(clamped.focus.dimming).toBe(0);
		expect(normalizeReadingSettings({ textSizeStep: -9 }).textSizeStep).toBe(-2);
	});

	it("tells the defaults apart from any change", () => {
		expect(isDefaultReadingSettings(DEFAULT_READING_SETTINGS)).toBe(true);
		expect(isDefaultReadingSettings({ ...DEFAULT_READING_SETTINGS, mode: "dark" })).toBe(false);
		expect(
			isDefaultReadingSettings({
				...DEFAULT_READING_SETTINGS,
				focus: { movesWith: "scroll", dimming: 70 },
			}),
		).toBe(false);
	});
});
