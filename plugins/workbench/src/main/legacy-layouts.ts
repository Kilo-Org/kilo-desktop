import { layoutPresetSchema, type LayoutsState } from "../contracts";

/** Origin's slot types → the pane kinds of the plugins that take them over. */
export const LEGACY_SLOT_KINDS: Readonly<Record<string, string>> = {
	chat: "kilo.chat/agent",
	changes: "kilo.git/changes",
	terminal: "kilo.terminal/terminal",
	files: "kilo.files/files",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads origin's `layout-presets.json` (`{version: 1, state}`, slots typed
 * chat / changes / terminal / files) as v2 presets. Presets that don't map
 * or validate are dropped; null when there is nothing usable.
 */
export function readLegacyLayouts(stored: unknown): LayoutsState | null {
	if (!isRecord(stored) || stored.version !== 1 || !isRecord(stored.state)) return null;
	const presets = Array.isArray(stored.state.presets) ? stored.state.presets : [];
	const converted = presets.flatMap((preset) => {
		if (!isRecord(preset) || !isRecord(preset.template)) return [];
		const slots = Array.isArray(preset.template.slots) ? preset.template.slots : [];
		const mapped = slots.map((slot) =>
			isRecord(slot) && typeof slot.type === "string" && LEGACY_SLOT_KINDS[slot.type]
				? { id: slot.id, kind: LEGACY_SLOT_KINDS[slot.type] }
				: null,
		);
		if (mapped.some((slot) => slot === null)) return [];
		return [{ ...preset, template: { ...preset.template, version: 2, slots: mapped } }];
	});
	const valid = converted
		.map((preset) => layoutPresetSchema.safeParse(preset))
		.flatMap((result) => (result.success ? [result.data] : []))
		.slice(0, 100);
	if (valid.length === 0) return null;
	const defaultPresetId = stored.state.defaultPresetId;
	return {
		presets: valid,
		defaultPresetId: valid.some((preset) => preset.id === defaultPresetId)
			? (defaultPresetId as string)
			: null,
	};
}
