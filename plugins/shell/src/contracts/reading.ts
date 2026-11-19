import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";
import {
	READING_PRESET_ID_MAX,
	READING_PRESET_LIMIT,
	READING_PRESET_NAME_MAX,
	type ReadingPreset,
	type ReadingPresetsState,
} from "@kilo-desktop/ui/lib/reading/presets";
import {
	FOCUS_MOVES_WITH,
	READING_MODES,
	TEXT_SIZE_STEP_RANGE,
	type ReadingSettings,
} from "@kilo-desktop/ui/lib/reading/settings";
import { APP_THEMES } from "@kilo-desktop/ui/themes/app-themes";

const nothing = z.undefined();
const themeIds = APP_THEMES.map(({ id }) => id) as [string, ...string[]];

const readingFocusSchema = z.object({
	movesWith: z.enum(FOCUS_MOVES_WITH),
	dimming: z.number().int().min(0).max(100),
});

export const readingStateSchema = z.object({
	/** One of the app's Appearance themes; null follows the app's theme. */
	themeId: z.enum(themeIds).nullable(),
	mode: z.enum(READING_MODES),
	textSizeStep: z.number().int().min(TEXT_SIZE_STEP_RANGE.min).max(TEXT_SIZE_STEP_RANGE.max),
	lineSpacing: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
	focus: readingFocusSchema,
}) as unknown as z.ZodType<ReadingSettings>;

export const readingPatchSchema = z.object({
	themeId: z.enum(themeIds).nullable().optional(),
	mode: z.enum(READING_MODES).optional(),
	textSizeStep: z
		.number()
		.int()
		.min(TEXT_SIZE_STEP_RANGE.min)
		.max(TEXT_SIZE_STEP_RANGE.max)
		.optional(),
	lineSpacing: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
	focus: readingFocusSchema.partial().optional(),
});
export type ReadingPatch = z.output<typeof readingPatchSchema>;

/**
 * Reading preferences for long text, shared by every window: the reading
 * theme (Focus only), text size step and line spacing (reply text, plans,
 * Markdown previews and Focus), and Focus's options. Owned by kilo.shell next
 * to Appearance so every reading surface, in any plugin, reads one set.
 */
export const Reading = defineDomainObject({
	id: "kilo.shell/reading",
	home: "main",
	description:
		"Reading preferences for long text: reading theme, text size, line spacing and Focus.",
	state: readingStateSchema,
	methods: {
		update: method(readingPatchSchema, readingStateSchema),
		reset: method(nothing, readingStateSchema),
	},
});

const presetId = z.string().min(1).max(READING_PRESET_ID_MAX);
const presetName = z.string().trim().min(1).max(READING_PRESET_NAME_MAX);

export const readingPresetSchema = z.object({
	id: presetId,
	name: presetName,
	settings: readingStateSchema,
}) as unknown as z.ZodType<ReadingPreset>;

export const readingPresetsStateSchema = z.object({
	presets: z.array(readingPresetSchema).max(READING_PRESET_LIMIT),
	activeId: presetId.nullable(),
	defaultId: presetId.nullable(),
}) as unknown as z.ZodType<ReadingPresetsState>;

/**
 * Named snapshots of the Reading preferences, shared by every window. Applying
 * one replaces the Reading preferences everywhere; `activeId` names the preset
 * last applied, saved or updated, so the Aa control can show it and offer to
 * update it once the preferences move on. The default preset (`defaultId`) is
 * applied each time Kilo opens. Snapshots are always taken in main from the
 * current Reading state, never sent by a window.
 */
export const ReadingPresets = defineDomainObject({
	id: "kilo.shell/reading-presets",
	home: "main",
	description: "Saved reading presets, the one in use and the one applied when Kilo opens.",
	state: readingPresetsStateSchema,
	methods: {
		/** Saves the current Reading preferences as a new preset, which becomes the active one. */
		save: method(
			z.object({ name: presetName, makeDefault: z.boolean().optional() }),
			readingPresetSchema,
		),
		/**
		 * Replaces the Reading preferences with the preset's; null matches
		 * Settings → Appearance (the standard preferences) and leaves no preset active.
		 */
		apply: method(z.object({ id: presetId.nullable() }), readingStateSchema),
		/** Overwrites the preset with the current Reading preferences. */
		update: method(z.object({ id: presetId }), readingPresetSchema),
		rename: method(z.object({ id: presetId, name: presetName }), nothing),
		remove: method(z.object({ id: presetId }), nothing),
		setDefault: method(z.object({ id: presetId.nullable() }), nothing),
	},
});

export const readingUsageStateSchema = z.object({
	focusVisits: z.number().int().min(0),
	lastFocusEnteredAt: z.number().nullable(),
	lastFocusExit: z.object({ at: z.number(), workSessionId: z.string() }).nullable(),
});
export type ReadingUsageState = z.output<typeof readingUsageStateSchema>;

/**
 * Local counts of Focus visits. Read only to derive bucketed telemetry fields
 * (first visit, lifetime visits, days since the last); the raw values are
 * never sent.
 */
export const ReadingUsage = defineDomainObject({
	id: "kilo.shell/reading-usage",
	home: "main",
	description: "Local counts of Focus visits, for content-free telemetry only.",
	state: readingUsageStateSchema,
	methods: {
		/** Counts a visit; answers the state from before it. */
		recordFocusEntered: method(nothing, readingUsageStateSchema),
		recordFocusExited: method(z.object({ workSessionId: z.string() }), nothing),
	},
});

export const READING_DOMAIN_OBJECTS = [Reading, ReadingPresets, ReadingUsage];
