import { mainHost, type KvStore, type PluginSdk } from "@kilo-desktop/kernel";

import type { WorkSession, WorkSessionPanes, Workspace } from "../../contracts/model";
import type { LayoutPresetsState } from "../../contracts/ui/layout-presets";

/**
 * The kv namespaces kilo.work-sessions keeps in its storage folder, one per
 * area, each a single value so every change is one atomic write. The storage
 * area fills them from the predecessors' folders before the areas open them,
 * so they are declared here, shared by both.
 */

export interface PersistedWorkspaces extends Record<string, unknown> {
	workspaces: Workspace[];
	activeId: string | null;
	/** Set once origin's workspaces have been read (or there were none to read). */
	importedFromOrigin: boolean;
}

export interface PersistedWorkSessions extends Record<string, unknown> {
	workSessions: WorkSession[];
	/** Set once origin's work sessions have been read (or there were none to read). */
	importedFromOrigin: boolean;
	/** Whether origin's work sessions a release imported as live were reopened to their chats' archives. */
	originArchivesReopened: boolean;
}

export interface PersistedPanes extends Record<string, unknown> {
	byWorkSession: Record<string, WorkSessionPanes>;
}

export interface PersistedLayoutPresets extends Record<string, unknown>, LayoutPresetsState {
	/** Set once origin's presets have been read (or there were none to read). */
	importedFromOrigin: boolean;
}

/** One-time moves that happened in this storage folder. */
export interface PersistedAdoption extends Record<string, unknown> {
	/** The kv namespaces filled from a predecessor's storage (or found to have nothing to adopt). */
	adopted: string[];
	/** Keybinding overrides saved under the predecessors' command keys were moved. */
	keybindingsMoved: boolean;
}

export const WORKSPACES_NAMESPACE = "workspaces";
export const WORK_SESSIONS_NAMESPACE = "work-sessions";
export const PANES_NAMESPACE = "panes";
export const LAYOUT_PRESETS_NAMESPACE = "layout-presets";
export const ADOPTION_NAMESPACE = "adoption";

export function workspacesStore(sdk: PluginSdk): KvStore<PersistedWorkspaces> {
	return mainHost(sdk).storage.kv<PersistedWorkspaces>({
		namespace: WORKSPACES_NAMESPACE,
		defaults: { workspaces: [], activeId: null, importedFromOrigin: false },
	});
}

export function workSessionsStore(sdk: PluginSdk): KvStore<PersistedWorkSessions> {
	return mainHost(sdk).storage.kv<PersistedWorkSessions>({
		namespace: WORK_SESSIONS_NAMESPACE,
		defaults: { workSessions: [], importedFromOrigin: false, originArchivesReopened: false },
	});
}

export function panesStore(sdk: PluginSdk): KvStore<PersistedPanes> {
	return mainHost(sdk).storage.kv<PersistedPanes>({
		namespace: PANES_NAMESPACE,
		defaults: { byWorkSession: {} },
	});
}

export function layoutPresetsStore(sdk: PluginSdk): KvStore<PersistedLayoutPresets> {
	return mainHost(sdk).storage.kv<PersistedLayoutPresets>({
		namespace: LAYOUT_PRESETS_NAMESPACE,
		defaults: { presets: [], defaultPresetId: null, importedFromOrigin: false },
	});
}

export function adoptionStore(sdk: PluginSdk): KvStore<PersistedAdoption> {
	return mainHost(sdk).storage.kv<PersistedAdoption>({
		namespace: ADOPTION_NAMESPACE,
		defaults: { adopted: [], keybindingsMoved: false },
	});
}
