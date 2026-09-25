import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk";
import { z } from "zod";

import {
	layoutPresetsContract,
	layoutPresetsStateSchema,
	type LayoutPresetsState,
} from "../../contracts/layout-presets/schemas.js";

const storedSchema = z.object({ version: z.literal(1), state: layoutPresetsStateSchema });

/**
 * Owns the plugin's versioned saved layouts. Each handler reads the durable snapshot
 * rather than caching it, and validates the complete state before each write.
 * Invalid or unsupported snapshots warn and read as empty without a destructive
 * read-time rewrite; the next explicit mutation replaces them with a validated v1 snapshot.
 * Browser tests inject an in-memory snapshot; desktop always uses durable KV.
 */
export function registerLayoutPresets(
	mainSdk: MainSdk,
	store: {
		snapshot: () => unknown;
		set: (value: { version: number; state: LayoutPresetsState }) => void;
	} = mainSdk.storage.kv({
		namespace: "layout-presets",
		defaults: { version: 1, state: { presets: [], defaultPresetId: null } as LayoutPresetsState },
	}),
): void {
	const get = (): LayoutPresetsState => {
		const parsed = storedSchema.safeParse(store.snapshot());
		if (parsed.success) return parsed.data.state;
		mainSdk.logger.warn(
			"Stored layout presets are invalid or unsupported; treating them as empty. The next successful mutation will replace the stored snapshot.",
		);
		return { presets: [], defaultPresetId: null };
	};
	const requirePreset = (state: LayoutPresetsState, id: string) => {
		if (!state.presets.some((preset) => preset.id === id)) {
			throw new FeatureError("Layout preset not found.", "NOT_FOUND");
		}
	};
	const write = (state: LayoutPresetsState) => {
		const parsed = layoutPresetsStateSchema.safeParse(state);
		if (!parsed.success)
			throw new FeatureError("Layout preset limits exceeded or layout is invalid.", "VALIDATION");
		try {
			store.set({ version: 1, state: parsed.data });
		} catch (error) {
			mainSdk.logger.error("Could not persist layout presets.", error);
			throw new FeatureError("Could not save layout presets. Please try again.", "BUSINESS");
		}
		mainSdk.events.emit("layout-presets-changed", undefined);
		return parsed.data;
	};
	mainSdk.channels(layoutPresetsContract).handleAll({
		"layoutPresets.get": async () => get(),
		"layoutPresets.save": async ({ id, name, template, makeDefault }) => {
			const current = get();
			if (id !== undefined) requirePreset(current, id);
			const preset = { id: id ?? crypto.randomUUID(), name, template };
			return write({
				presets:
					id === undefined
						? [...current.presets, preset]
						: current.presets.map((entry) => (entry.id === id ? preset : entry)),
				defaultPresetId: makeDefault ? preset.id : current.defaultPresetId,
			});
		},
		"layoutPresets.rename": async ({ id, name }) => {
			const current = get();
			requirePreset(current, id);
			return write({
				...current,
				presets: current.presets.map((preset) => (preset.id === id ? { ...preset, name } : preset)),
			});
		},
		"layoutPresets.remove": async ({ id }) => {
			const current = get();
			requirePreset(current, id);
			return write({
				presets: current.presets.filter((preset) => preset.id !== id),
				defaultPresetId: current.defaultPresetId === id ? null : current.defaultPresetId,
			});
		},
		"layoutPresets.setDefault": async ({ id }) => {
			const current = get();
			if (id !== null) requirePreset(current, id);
			return write({ ...current, defaultPresetId: id });
		},
	});
}
