import { describe, expect, it } from "vitest";

import {
	EMPTY_READING_PRESETS,
	READING_PRESET_LIMIT,
	activeReadingPreset,
	hasUnsavedReadingChanges,
	normalizePresetName,
	normalizeReadingPresets,
	presetNameTaken,
	readingPresetSummary,
	type ReadingPreset,
} from "./presets";
import { DEFAULT_READING_SETTINGS, type ReadingSettings } from "./settings";

const LATE_NIGHT: ReadingSettings = {
	themeId: "gruvbox",
	mode: "dark",
	textSizeStep: 2,
	lineSpacing: 2,
	focus: { movesWith: "keys", dimming: 80 },
};

const preset = (id: string, name: string, settings = DEFAULT_READING_SETTINGS): ReadingPreset => ({
	id,
	name,
	settings,
});

describe("reading preset names", () => {
	it("trims names and rejects empty or over-long ones", () => {
		expect(normalizePresetName("  Late night ")).toBe("Late night");
		expect(normalizePresetName("   ")).toBeNull();
		expect(normalizePresetName("x".repeat(101))).toBeNull();
		expect(normalizePresetName("x".repeat(100))).toHaveLength(100);
		expect(normalizePresetName(42)).toBeNull();
	});

	it("finds a taken name regardless of case, except on the preset being renamed", () => {
		const presets = [preset("a", "Late night")];
		expect(presetNameTaken(presets, "late NIGHT")).toBe(true);
		expect(presetNameTaken(presets, " Late night ", "a")).toBe(false);
		expect(presetNameTaken(presets, "Daytime")).toBe(false);
	});
});

describe("normalizeReadingPresets", () => {
	it("keeps valid presets and normalizes their settings", () => {
		const state = normalizeReadingPresets({
			presets: [
				{ id: "a", name: " Late night ", settings: LATE_NIGHT },
				{ id: "b", name: "Odd", settings: { textSizeStep: 40 } },
			],
			activeId: "a",
			defaultId: "b",
		});
		expect(state).toEqual({
			presets: [
				preset("a", "Late night", LATE_NIGHT),
				preset("b", "Odd", { ...DEFAULT_READING_SETTINGS, textSizeStep: 6 }),
			],
			activeId: "a",
			defaultId: "b",
		});
	});

	it("drops broken entries, duplicate ids and names, and dangling pointers", () => {
		const state = normalizeReadingPresets({
			presets: [
				{ id: "a", name: "One" },
				{ id: "", name: "No id" },
				{ id: "b", name: "" },
				{ id: "a", name: "Same id" },
				{ id: "c", name: "ONE" },
				"junk",
			],
			activeId: "gone",
			defaultId: 7,
		});
		expect(state).toEqual({
			presets: [preset("a", "One")],
			activeId: null,
			defaultId: null,
		});
	});

	it("caps the list and falls back to empty for junk", () => {
		const many = Array.from({ length: READING_PRESET_LIMIT + 5 }, (_, index) =>
			preset(`p${index}`, `Preset ${index}`),
		);
		expect(normalizeReadingPresets({ presets: many }).presets).toHaveLength(READING_PRESET_LIMIT);
		expect(normalizeReadingPresets(null)).toEqual(EMPTY_READING_PRESETS);
	});
});

describe("active preset and unsaved changes", () => {
	const state = {
		presets: [preset("a", "Late night", LATE_NIGHT)],
		activeId: "a",
		defaultId: null,
	};

	it("resolves the active preset", () => {
		expect(activeReadingPreset(state)?.name).toBe("Late night");
		expect(activeReadingPreset({ ...state, activeId: null })).toBeNull();
	});

	it("compares the live settings with the active preset, or the defaults without one", () => {
		expect(hasUnsavedReadingChanges(LATE_NIGHT, state)).toBe(false);
		expect(hasUnsavedReadingChanges({ ...LATE_NIGHT, textSizeStep: 3 }, state)).toBe(true);
		const none = { ...state, activeId: null };
		expect(hasUnsavedReadingChanges(DEFAULT_READING_SETTINGS, none)).toBe(false);
		expect(hasUnsavedReadingChanges(LATE_NIGHT, none)).toBe(true);
	});
});

describe("readingPresetSummary", () => {
	it("names the theme, a fixed mode, the size in px, the spacing and how Focus moves", () => {
		expect(readingPresetSummary(LATE_NIGHT, 14)).toEqual([
			"Gruvbox",
			"Dark",
			"16px",
			"Loose",
			"Focus: Keys",
		]);
	});

	it("says App theme and leaves out Auto", () => {
		expect(readingPresetSummary(DEFAULT_READING_SETTINGS, 14)).toEqual([
			"App theme",
			"14px",
			"Tight",
			"Focus: Scrolling",
		]);
	});
});
