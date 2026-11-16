import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

import { ARRANGEMENTS } from "../model/panes";

/** The `kernel/flag` (a LaunchDarkly key) that turns layout presets on. */
export const CHAT_LAYOUTS_FLAG = "chat-layouts";
/** The context key that is true while layout presets are on. */
export const CHAT_LAYOUTS_FLAG_KEY = `kernel/flag:${CHAT_LAYOUTS_FLAG}`;

const presetId = z.string().trim().min(1).max(128);
const presetName = z.string().trim().min(1).max(100);

/**
 * A saved arrangement of panes: slots name a pane kind, groups place them as
 * the canvas does (columns, tabs, vertical stacks, widths, pins).
 */
export const layoutTemplateSchema = z
	.object({
		version: z.literal(2),
		arrangement: z.enum(ARRANGEMENTS),
		activePaneId: presetId.optional(),
		slots: z.array(z.object({ id: presetId, kind: z.string().min(1).max(256) })).max(64),
		groups: z
			.array(
				z.object({
					id: presetId,
					tabs: z.array(presetId).min(1).max(64),
					activePaneId: presetId,
					width: z.number().positive().max(100_000),
					pinned: z.boolean(),
					stackId: z
						.string()
						.regex(/^[a-zA-Z0-9:_-]{1,128}$/)
						.optional(),
					stackWeight: z.number().positive().max(1).optional(),
				}),
			)
			.max(64),
	})
	.superRefine((template, ctx) => {
		const issue = (message: string) => ctx.addIssue({ code: "custom", message });
		const slots = new Set(template.slots.map((slot) => slot.id));
		if (slots.size !== template.slots.length) issue("Slot IDs must be unique.");
		if (new Set(template.groups.map((group) => group.id)).size !== template.groups.length) {
			issue("Group IDs must be unique.");
		}
		const placed = new Set<string>();
		const stacks = new Map<string, (typeof template.groups)[number][]>();
		for (const [index, group] of template.groups.entries()) {
			for (const tab of group.tabs) {
				if (!slots.has(tab) || placed.has(tab)) issue("Each tab must reference a unique slot.");
				placed.add(tab);
			}
			if (!group.tabs.includes(group.activePaneId)) issue("The active pane must be in its group.");
			if (group.stackId !== undefined) {
				const stack = stacks.get(group.stackId) ?? [];
				if (stack.length > 0 && template.groups[index - 1]?.stackId !== group.stackId) {
					issue("Stack groups must be contiguous.");
				}
				stack.push(group);
				stacks.set(group.stackId, stack);
			} else if (group.stackWeight !== undefined) {
				issue("Stack weights require a stack ID.");
			}
		}
		if (placed.size !== slots.size) issue("Each slot must be placed once.");
		if (template.activePaneId !== undefined && !slots.has(template.activePaneId)) {
			issue("The active pane must reference a layout slot.");
		}
		for (const stack of stacks.values()) {
			if (stack.length < 2) issue("A stack needs at least two groups.");
			if (stack.some((group) => group.pinned !== stack[0]!.pinned))
				issue("Stack pinning must agree.");
			const weights = stack.flatMap((group) =>
				group.stackWeight === undefined ? [] : [group.stackWeight],
			);
			if (
				weights.length > 0 &&
				(weights.length !== stack.length ||
					Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-6)
			) {
				issue("Stack weights must all be supplied and sum to one, or all be omitted.");
			}
		}
	});
export type LayoutTemplate = z.output<typeof layoutTemplateSchema>;

export const layoutPresetSchema = z.object({
	id: presetId,
	name: presetName,
	template: layoutTemplateSchema,
});
export type LayoutPreset = z.output<typeof layoutPresetSchema>;

export const layoutPresetsStateSchema = z.object({
	presets: z.array(layoutPresetSchema).max(100),
	/** Applied to each new work session; null for none. */
	defaultPresetId: presetId.nullable(),
});
export type LayoutPresetsState = z.output<typeof layoutPresetsStateSchema>;

/** Saved layout presets and the default one, shared by every window. */
export const LayoutPresets = defineDomainObject({
	id: "kilo.work-sessions/layout-presets",
	home: "main",
	description: "Saved layout presets and the default one.",
	state: layoutPresetsStateSchema,
	lookup: (state, id) => state.presets.find((preset) => preset.id === id),
	methods: {
		save: method(
			z.object({
				id: presetId.optional(),
				name: presetName,
				template: layoutTemplateSchema,
				makeDefault: z.boolean().optional(),
			}),
			layoutPresetSchema,
		),
		rename: method(z.object({ id: presetId, name: presetName }), z.undefined()),
		remove: method(z.object({ id: presetId }), z.undefined()),
		setDefault: method(z.object({ id: presetId.nullable() }), z.undefined()),
	},
});
