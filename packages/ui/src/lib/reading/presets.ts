import { APP_THEMES } from "../../themes/app-themes";
import {
	DEFAULT_READING_SETTINGS,
	LINE_SPACING_LABELS,
	isDefaultReadingSettings,
	normalizeReadingSettings,
	sameReadingSettings,
	type FocusMovesWith,
	type ReadingSettings,
} from "./settings";

/** Same limits as layout presets, so both preset lists behave alike. */
export const READING_PRESET_NAME_MAX = 100;
export const READING_PRESET_LIMIT = 100;
export const READING_PRESET_ID_MAX = 128;

export interface ReadingPreset {
	readonly id: string;
	readonly name: string;
	readonly settings: ReadingSettings;
}

export interface ReadingPresetsState {
	readonly presets: readonly ReadingPreset[];
	/** The preset last applied, saved or updated; the live settings may have moved on from it. */
	readonly activeId: string | null;
	/** Applied each time Kilo opens; null keeps the last settings used. */
	readonly defaultId: string | null;
}

export const EMPTY_READING_PRESETS: ReadingPresetsState = {
	presets: [],
	activeId: null,
	defaultId: null,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** The trimmed name, or null when it is empty or too long. */
export function normalizePresetName(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= READING_PRESET_NAME_MAX ? trimmed : null;
}

/** Whether another preset already uses this name (case-insensitive). */
export function presetNameTaken(
	presets: readonly ReadingPreset[],
	name: string,
	exceptId?: string,
): boolean {
	const wanted = name.trim().toLocaleLowerCase();
	return presets.some(
		(preset) => preset.id !== exceptId && preset.name.toLocaleLowerCase() === wanted,
	);
}

function normalizeId(id: unknown): string | null {
	return typeof id === "string" && id.length > 0 && id.length <= READING_PRESET_ID_MAX ? id : null;
}

/**
 * Keeps the valid presets of stored state: each needs an id and a name, ids
 * and names are unique, settings are normalized, the list is capped, and
 * pointers to presets that are gone become null.
 */
export function normalizeReadingPresets(value: unknown): ReadingPresetsState {
	const input = isObject(value) ? value : {};
	const entries = Array.isArray(input.presets) ? input.presets : [];
	const presets: ReadingPreset[] = [];
	for (const entry of entries) {
		if (presets.length >= READING_PRESET_LIMIT) break;
		if (!isObject(entry)) continue;
		const id = normalizeId(entry.id);
		const name = normalizePresetName(entry.name);
		if (id === null || name === null) continue;
		if (presets.some((preset) => preset.id === id) || presetNameTaken(presets, name)) continue;
		presets.push({ id, name, settings: normalizeReadingSettings(entry.settings) });
	}
	const pointer = (id: unknown) =>
		typeof id === "string" && presets.some((preset) => preset.id === id) ? id : null;
	return { presets, activeId: pointer(input.activeId), defaultId: pointer(input.defaultId) };
}

export function activeReadingPreset(state: ReadingPresetsState): ReadingPreset | null {
	return state.presets.find((preset) => preset.id === state.activeId) ?? null;
}

/**
 * Whether the live settings are worth saving: they differ from the active
 * preset, or, with none active, from the defaults.
 */
export function hasUnsavedReadingChanges(
	live: ReadingSettings,
	state: ReadingPresetsState,
): boolean {
	const active = activeReadingPreset(state);
	return active ? !sameReadingSettings(live, active.settings) : !isDefaultReadingSettings(live);
}

const MOVES_WITH_NAMES: Record<FocusMovesWith, string> = {
	scroll: "Scrolling",
	pointer: "Pointer",
	keys: "Keys",
};

/** What a preset holds, as short parts: theme, a fixed mode, size, spacing and how Focus moves. */
export function readingPresetSummary(
	settings: ReadingSettings,
	chatBaseSize: number,
): readonly string[] {
	const theme =
		settings.themeId === null
			? "App theme"
			: (APP_THEMES.find(({ id }) => id === settings.themeId)?.name ?? settings.themeId);
	const mode = settings.mode === "light" ? "Light" : settings.mode === "dark" ? "Dark" : null;
	return [
		theme,
		...(mode ? [mode] : []),
		`${chatBaseSize + settings.textSizeStep}px`,
		LINE_SPACING_LABELS[settings.lineSpacing] ??
			LINE_SPACING_LABELS[DEFAULT_READING_SETTINGS.lineSpacing],
		`Focus: ${MOVES_WITH_NAMES[settings.focus.movesWith]}`,
	];
}
