import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

const idSchema = z.string().trim().min(1).max(128);
const nameSchema = z.string().trim().min(1).max(100);

export const layoutTemplateSchema = z
	.object({
		version: z.literal(1),
		arrangement: z.enum(["tiles", "carousel"]),
		activePaneId: idSchema.optional(),
		slots: z
			.array(z.object({ id: idSchema, type: z.enum(["chat", "changes", "terminal", "files"]) }))
			.max(64),
		groups: z
			.array(
				z.object({
					id: idSchema,
					tabs: z.array(idSchema).min(1).max(64),
					activePaneId: idSchema,
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
		const chatCount = template.slots.filter((slot) => slot.type === "chat").length;
		if (chatCount > 1) issue("A layout can contain at most one chat slot.");
		const slots = new Set(template.slots.map((slot) => slot.id));
		if (slots.size !== template.slots.length) issue("Slot IDs must be unique.");
		if (new Set(template.groups.map((group) => group.id)).size !== template.groups.length) {
			issue("Group IDs must be unique.");
		}
		const placed = new Set<string>();
		const stacks = new Map<string, typeof template.groups>();
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
export type LayoutTemplate = z.infer<typeof layoutTemplateSchema>;

export const layoutPresetSchema = z.object({
	id: idSchema,
	name: nameSchema,
	template: layoutTemplateSchema,
});
export type LayoutPreset = z.infer<typeof layoutPresetSchema>;

export const layoutPresetsStateSchema = z
	.object({
		presets: z.array(layoutPresetSchema).max(100),
		defaultPresetId: idSchema.nullable(),
	})
	.superRefine((state, ctx) => {
		const ids = new Set(state.presets.map((preset) => preset.id));
		if (ids.size !== state.presets.length)
			ctx.addIssue({ code: "custom", message: "Preset IDs must be unique." });
		if (state.defaultPresetId !== null && !ids.has(state.defaultPresetId)) {
			ctx.addIssue({ code: "custom", message: "The default must reference a saved preset." });
		}
	});
export type LayoutPresetsState = z.infer<typeof layoutPresetsStateSchema>;

export const layoutPresetsContract = defineContract({
	"layoutPresets.get": defineMethod(z.undefined(), layoutPresetsStateSchema),
	"layoutPresets.save": defineMethod(
		z.object({
			id: idSchema.optional(),
			name: nameSchema,
			template: layoutTemplateSchema,
			makeDefault: z.boolean().optional(),
		}),
		layoutPresetsStateSchema,
	),
	"layoutPresets.rename": defineMethod(
		z.object({ id: idSchema, name: nameSchema }),
		layoutPresetsStateSchema,
	),
	"layoutPresets.remove": defineMethod(z.object({ id: idSchema }), layoutPresetsStateSchema),
	"layoutPresets.setDefault": defineMethod(
		z.object({ id: idSchema.nullable() }),
		layoutPresetsStateSchema,
	),
});
export type LayoutPresetsService = InferContract<typeof layoutPresetsContract>;
