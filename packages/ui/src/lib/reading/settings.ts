import { APP_THEMES } from "../../themes/app-themes";

/** Reading theme modes: "auto" follows the app's resolved light/dark. */
export const READING_MODES = ["auto", "light", "dark"] as const;
export type ReadingMode = (typeof READING_MODES)[number];

/** How the focused passage in Focus follows the reader. */
export const FOCUS_MOVES_WITH = ["scroll", "pointer", "keys"] as const;
export type FocusMovesWith = (typeof FOCUS_MOVES_WITH)[number];

/** Text size steps are 1px each, relative to a surface's base size. */
export const TEXT_SIZE_STEP_RANGE = { min: -2, max: 6 } as const;

/** Four line spacings, tightest to loosest; each surface maps them to line heights. */
export const LINE_SPACING_COUNT = 4;
export type LineSpacing = 0 | 1 | 2 | 3;
export const LINE_SPACING_LABELS = ["Tightest", "Tight", "Loose", "Loosest"] as const;

export type ReadingThemeId = (typeof APP_THEMES)[number]["id"];

export interface ReadingSettings {
	/** One of the app's Appearance themes; null follows the app's theme. */
	readonly themeId: ReadingThemeId | null;
	readonly mode: ReadingMode;
	readonly textSizeStep: number;
	readonly lineSpacing: LineSpacing;
	readonly focus: {
		readonly movesWith: FocusMovesWith;
		/** 0 (no dimming) – 100 (strongest); 60 draws the designed steps. */
		readonly dimming: number;
	};
}

/** A change to some settings; `focus` fields merge into the current ones. */
export interface ReadingSettingsPatch {
	readonly themeId?: ReadingThemeId | null;
	readonly mode?: ReadingMode;
	readonly textSizeStep?: number;
	readonly lineSpacing?: LineSpacing;
	readonly focus?: Partial<ReadingSettings["focus"]>;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
	themeId: null,
	mode: "auto",
	textSizeStep: 0,
	lineSpacing: 1,
	focus: { movesWith: "scroll", dimming: 60 },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
	return options.includes(value as T) ? (value as T) : fallback;
}

/** Keeps the valid parts of stored or patched settings; everything else falls back to the default. */
export function normalizeReadingSettings(value: unknown): ReadingSettings {
	const input = isObject(value) ? value : {};
	const focus = isObject(input.focus) ? input.focus : {};
	const defaults = DEFAULT_READING_SETTINGS;
	const themeId = APP_THEMES.some(({ id }) => id === input.themeId)
		? (input.themeId as ReadingThemeId)
		: null;
	const step = Number.isInteger(input.textSizeStep)
		? clamp(input.textSizeStep as number, TEXT_SIZE_STEP_RANGE.min, TEXT_SIZE_STEP_RANGE.max)
		: defaults.textSizeStep;
	const spacing =
		Number.isInteger(input.lineSpacing) &&
		(input.lineSpacing as number) >= 0 &&
		(input.lineSpacing as number) < LINE_SPACING_COUNT
			? (input.lineSpacing as LineSpacing)
			: defaults.lineSpacing;
	const dimming =
		typeof focus.dimming === "number" && Number.isFinite(focus.dimming)
			? Math.round(clamp(focus.dimming, 0, 100))
			: defaults.focus.dimming;
	return {
		themeId,
		mode: oneOf(READING_MODES, input.mode, defaults.mode),
		textSizeStep: step,
		lineSpacing: spacing,
		focus: {
			movesWith: oneOf(FOCUS_MOVES_WITH, focus.movesWith, defaults.focus.movesWith),
			dimming,
		},
	};
}

export function sameReadingSettings(a: ReadingSettings, b: ReadingSettings): boolean {
	return (
		a.themeId === b.themeId &&
		a.mode === b.mode &&
		a.textSizeStep === b.textSizeStep &&
		a.lineSpacing === b.lineSpacing &&
		a.focus.movesWith === b.focus.movesWith &&
		a.focus.dimming === b.focus.dimming
	);
}

export function isDefaultReadingSettings(settings: ReadingSettings): boolean {
	return sameReadingSettings(settings, DEFAULT_READING_SETTINGS);
}
