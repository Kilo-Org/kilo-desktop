import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { definePlugin, KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { Layouts, type LayoutsState } from "../contracts";
import { readLegacyLayouts } from "./legacy-layouts";

interface PersistedLayouts extends Record<string, unknown>, LayoutsState {
	importedFromOrigin: boolean;
}

const RETRY = Symbol("retry");

const MAX_PRESETS = 100;

/**
 * Origin's presets after the ones saved here (an import retried on a later
 * launch must not undo them): a preset here keeps its id, and so does the
 * default chosen here.
 */
function underCurrent(current: LayoutsState, origin: LayoutsState): LayoutsState {
	const ids = new Set(current.presets.map((preset) => preset.id));
	const presets = [
		...current.presets,
		...origin.presets.filter((preset) => !ids.has(preset.id)),
	].slice(0, MAX_PRESETS);
	const originDefault = presets.some((preset) => preset.id === origin.defaultPresetId)
		? origin.defaultPresetId
		: null;
	return { presets, defaultPresetId: current.defaultPresetId ?? originDefault };
}

export interface WorkbenchMainOptions {
	/** Origin's saved presets, read once. */
	readonly originLayouts?: (sdk: PluginSdk) => string;
	readonly createId?: () => string;
}

/**
 * kilo.workbench's main entry: saved layout presets in kv, shared by every
 * window. Origin's presets are adopted once, their slot types mapped to pane
 * kinds, after any saved here; a preset whose kinds aren't installed applies
 * what it can.
 */
export function createWorkbenchMainEntry(options: WorkbenchMainOptions = {}) {
	const createId = options.createId ?? randomUUID;
	return definePlugin({
		async activate(sdk) {
			const store = mainHost(sdk).storage.kv<PersistedLayouts>({
				namespace: "layouts",
				defaults: { presets: [], defaultPresetId: null, importedFromOrigin: false },
			});
			const snapshot = (): LayoutsState => {
				const { presets, defaultPresetId } = store.snapshot();
				return { presets, defaultPresetId };
			};
			if (!store.snapshot().importedFromOrigin) {
				const origin = options.originLayouts ? await readOrigin(options.originLayouts(sdk)) : null;
				if (origin !== RETRY) {
					store.set({
						...(origin ? underCurrent(snapshot(), origin) : {}),
						importedFromOrigin: true,
					});
				}
			}

			const layouts = sdk.domains.provide(Layouts, {
				initialState: snapshot(),
				methods: {
					save: ({ id, name, template, makeDefault }) => {
						const current = snapshot();
						if (id !== undefined) requirePreset(current, id);
						if (id === undefined && current.presets.length >= MAX_PRESETS) {
							throw new KernelError("VALIDATION", "You can save up to 100 layouts.");
						}
						const preset = { id: id ?? createId(), name, template };
						write({
							presets:
								id === undefined
									? [...current.presets, preset]
									: current.presets.map((entry) => (entry.id === id ? preset : entry)),
							defaultPresetId: makeDefault ? preset.id : current.defaultPresetId,
						});
						return preset;
					},
					rename: ({ id, name }) => {
						const current = snapshot();
						requirePreset(current, id);
						write({
							...current,
							presets: current.presets.map((preset) =>
								preset.id === id ? { ...preset, name } : preset,
							),
						});
					},
					remove: ({ id }) => {
						const current = snapshot();
						requirePreset(current, id);
						write({
							presets: current.presets.filter((preset) => preset.id !== id),
							defaultPresetId: current.defaultPresetId === id ? null : current.defaultPresetId,
						});
					},
					setDefault: ({ id }) => {
						const current = snapshot();
						if (id !== null) requirePreset(current, id);
						write({ ...current, defaultPresetId: id });
					},
				},
			});

			function write(next: LayoutsState): void {
				store.set(next);
				layouts.setState(next);
			}
			function requirePreset(state: LayoutsState, id: string): void {
				if (!state.presets.some((preset) => preset.id === id)) {
					throw new KernelError("NOT_FOUND", "Layout not found.");
				}
			}
			/** A missing or unusable file counts as nothing to adopt; a read that fails is retried next launch. */
			async function readOrigin(file: string): Promise<LayoutsState | null | typeof RETRY> {
				let raw: string;
				try {
					raw = await readFile(file, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
					sdk.logger.warn(
						"Could not read origin's layout presets; will try again next launch",
						error,
					);
					return RETRY;
				}
				try {
					return readLegacyLayouts(JSON.parse(raw));
				} catch (error) {
					sdk.logger.warn("Origin's layout presets are unreadable", error);
					return null;
				}
			}
		},
	});
}
