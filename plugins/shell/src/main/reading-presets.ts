import { KernelError, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";
import {
	READING_PRESET_LIMIT,
	presetNameTaken,
	type ReadingPreset,
	type ReadingPresetsState,
} from "@kilo-desktop/ui/lib/reading/presets";
import {
	DEFAULT_READING_SETTINGS,
	type ReadingSettings,
} from "@kilo-desktop/ui/lib/reading/settings";

import { ReadingPresets } from "../contracts";

export interface ReadingPresetsDeps {
	readonly initialState: ReadingPresetsState;
	/** The current Reading preferences, the only source of a snapshot. */
	readonly current: () => ReadingSettings;
	/** Replaces the Reading preferences (saved and published). */
	readonly replace: (settings: ReadingSettings) => ReadingSettings;
	readonly persist: (state: ReadingPresetsState) => void;
	readonly createId?: () => string;
}

/**
 * Provides `kilo.shell/reading-presets` next to the Reading preferences.
 * Which preset to start from at launch is decided by the caller, before
 * Reading is provided, so the first Reading state a window sees is already
 * the default preset's. Names are unique regardless of case; a save beyond
 * the limit or a name already taken is refused with a VALIDATION error.
 */
export function provideReadingPresets(
	sdk: PluginSdk,
	deps: ReadingPresetsDeps,
): DomainObjectProvider<typeof ReadingPresets> {
	const createId = deps.createId ?? (() => crypto.randomUUID());

	const provider: DomainObjectProvider<typeof ReadingPresets> = sdk.domainObjects.provide(
		ReadingPresets,
		{
			initialState: deps.initialState,
			methods: {
				save: ({ name, makeDefault }) => {
					const state = provider.state;
					if (state.presets.length >= READING_PRESET_LIMIT) {
						throw new KernelError(
							"VALIDATION",
							`You can save up to ${READING_PRESET_LIMIT} reading presets.`,
						);
					}
					requireFreeName(state, name);
					const preset: ReadingPreset = { id: createId(), name, settings: deps.current() };
					write({
						presets: [...state.presets, preset],
						activeId: preset.id,
						defaultId: makeDefault ? preset.id : state.defaultId,
					});
					return preset;
				},
				apply: ({ id }) => {
					if (id === null) {
						const applied = deps.replace(DEFAULT_READING_SETTINGS);
						write({ ...provider.state, activeId: null });
						return applied;
					}
					const preset = requirePreset(provider.state, id);
					const applied = deps.replace(preset.settings);
					write({ ...provider.state, activeId: id });
					return applied;
				},
				update: ({ id }) => {
					const state = provider.state;
					const updated = { ...requirePreset(state, id), settings: deps.current() };
					write({
						...state,
						presets: state.presets.map((preset) => (preset.id === id ? updated : preset)),
						activeId: id,
					});
					return updated;
				},
				rename: ({ id, name }) => {
					const state = provider.state;
					requirePreset(state, id);
					requireFreeName(state, name, id);
					write({
						...state,
						presets: state.presets.map((preset) =>
							preset.id === id ? { ...preset, name } : preset,
						),
					});
				},
				remove: ({ id }) => {
					const state = provider.state;
					requirePreset(state, id);
					write({
						presets: state.presets.filter((preset) => preset.id !== id),
						activeId: state.activeId === id ? null : state.activeId,
						defaultId: state.defaultId === id ? null : state.defaultId,
					});
				},
				setDefault: ({ id }) => {
					const state = provider.state;
					if (id !== null) requirePreset(state, id);
					write({ ...state, defaultId: id });
				},
			},
		},
	);

	function write(next: ReadingPresetsState): void {
		deps.persist(next);
		provider.setState(next);
	}

	return provider;
}

function requirePreset(state: ReadingPresetsState, id: string): ReadingPreset {
	const preset = state.presets.find((entry) => entry.id === id);
	if (!preset) throw new KernelError("NOT_FOUND", "Reading preset not found.");
	return preset;
}

function requireFreeName(state: ReadingPresetsState, name: string, exceptId?: string): void {
	if (presetNameTaken(state.presets, name, exceptId)) {
		throw new KernelError("VALIDATION", `A reading preset named "${name.trim()}" already exists.`);
	}
}
