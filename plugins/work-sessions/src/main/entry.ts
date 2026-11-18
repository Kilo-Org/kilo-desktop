import { definePlugin, type PluginEntry, type PluginSdk } from "@kilo-desktop/kernel";

import { activateFileWatcher, type FileWatcherOptions } from "./file-watcher";
import { activateKeybindings } from "./keybindings";
import { activateLayoutPresets, type LayoutPresetsOptions } from "./layout-presets";
import { activatePanes, type PanesOptions } from "./panes";
import { activateStorage } from "./storage";
import { activateWorkSessions, type WorkSessionsOptions } from "./work-sessions";
import { activateWorkspaces, type WorkspacesOptions } from "./workspaces";

/** Each area's dependencies, built per activation (real ones in production, fakes in tests). */
export interface WorkSessionsMainOptions {
	readonly workspaces?: (sdk: PluginSdk) => WorkspacesOptions;
	readonly fileWatcher: (sdk: PluginSdk) => FileWatcherOptions;
	readonly workSessions?: (sdk: PluginSdk) => WorkSessionsOptions;
	readonly panes?: (sdk: PluginSdk) => PanesOptions;
	readonly layoutPresets?: (sdk: PluginSdk) => LayoutPresetsOptions;
}

/**
 * kilo.work-sessions in main, composed from areas that meet only through the
 * plugin's own domain objects. Order matters at activation: storage adopts
 * the predecessors' data before any area opens its kv; workspaces come
 * before what reads them (the watcher, work sessions); work sessions come
 * before panes, which drop a deleted work session's panes.
 */
export function createWorkSessionsMainEntry(options: WorkSessionsMainOptions): PluginEntry {
	return definePlugin({
		async activate(sdk) {
			await activateStorage(sdk);
			await activateKeybindings(sdk);
			activateWorkspaces(sdk, options.workspaces?.(sdk));
			activateFileWatcher(sdk, options.fileWatcher(sdk));
			await activateLayoutPresets(sdk, options.layoutPresets?.(sdk));
			activateWorkSessions(sdk, options.workSessions?.(sdk));
			activatePanes(sdk, options.panes?.(sdk));
		},
	});
}
