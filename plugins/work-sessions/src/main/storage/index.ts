import { readFile } from "node:fs/promises";
import path from "node:path";

import { mainHost, type KvStore, type PluginSdk } from "@kilo-desktop/kernel";

import { mergeProfiles, readFormerProfile, type ProfileData } from "./former-profile";
import {
	readLegacyLayoutPresets,
	readLegacyPanes,
	readLegacyWorkSessions,
	readLegacyWorkspaces,
	underById,
} from "./legacy";
import {
	adoptionStore,
	layoutPresetsStore,
	panesStore,
	workSessionsStore,
	workspacesStore,
} from "./stores";

/** Reads one kv value a predecessor kept: parsed JSON, or null when there is none. */
export type LegacyReader = (pluginId: string, namespace: string) => Promise<unknown>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A kv file in a sibling plugin folder (`../<pluginId>/<namespace>.json`). A
 * missing or corrupt file counts as nothing to adopt (the kv itself would
 * have reset a corrupt one); any other failure throws, to be retried.
 */
export function legacyFileReader(storageDirectory: string): LegacyReader {
	return async (pluginId, namespace) => {
		const file = path.join(storageDirectory, "..", pluginId, `${namespace}.json`);
		let text: string;
		try {
			text = await readFile(file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return null;
		}
	};
}

interface Adoption {
	/** `<predecessor>/<namespace>`, recorded once adopted. */
	readonly source: string;
	readonly pluginId: string;
	readonly namespace: string;
	/** Puts the predecessor's value beneath what this plugin already saved. */
	readonly adopt: (raw: unknown) => void;
}

/**
 * kilo.work-sessions took over kilo.workspaces, kilo.sessions and
 * kilo.workbench, whose kv values sit in sibling storage folders. Each is
 * adopted once, before any area opens its namespace, converted to the new
 * vocabulary (copies instead of worktrees, a pane's `object`, layout
 * presets). Usually there is nothing here yet; when an earlier launch could
 * not read a predecessor, what was saved since stays on top (ids saved here
 * win) and the predecessor's origin-import markers carry over, so origin's
 * data is not imported twice. A read that fails is retried next launch; the
 * predecessors' files are left in place for a downgrade.
 */
export async function activateStorage(sdk: PluginSdk): Promise<void> {
	const readLegacy = legacyFileReader(mainHost(sdk).storage.dir);
	const adoption = adoptionStore(sdk);
	const alreadyAdopted = new Set(adoption.snapshot().adopted);
	for (const step of adoptions(sdk)) {
		if (alreadyAdopted.has(step.source)) continue;
		try {
			// A few small files read once at launch; in order, so the adopted log keeps the declared order.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			const raw = await readLegacy(step.pluginId, step.namespace);
			if (raw !== null && raw !== undefined) step.adopt(raw);
			markAdopted(adoption, step.source);
		} catch (error) {
			sdk.logger.warn(
				`Could not adopt ${step.source}; will try again next launch: ${errorText(error)}`,
			);
		}
	}
	await importFormerProfiles(sdk, adoption);
}

/**
 * What this plugin saved in profiles merged into this one, once each, after
 * the predecessors (so it lands beneath their data too) and before any area
 * opens its namespace. A failed read is retried next launch.
 */
async function importFormerProfiles(
	sdk: PluginSdk,
	adoption: KvStore<{ adopted: string[] }>,
): Promise<void> {
	for (const dir of mainHost(sdk).storage.formerDirs ?? []) {
		const source = `profile:${dir}`;
		if (adoption.snapshot().adopted.includes(source)) continue;
		try {
			writeProfile(sdk, mergeProfiles(readProfile(sdk), await readFormerProfile(dir)));
			markAdopted(adoption, source);
		} catch (error) {
			sdk.logger.warn(
				`Could not import work sessions from ${dir}; will try again next launch: ${errorText(error)}`,
			);
		}
	}
}

function readProfile(sdk: PluginSdk): ProfileData {
	const workspaces = workspacesStore(sdk).snapshot();
	const presets = layoutPresetsStore(sdk).snapshot();
	return {
		workspaces: workspaces.workspaces,
		activeWorkspaceId: workspaces.activeId,
		workSessions: workSessionsStore(sdk).snapshot().workSessions,
		panes: panesStore(sdk).snapshot().byWorkSession,
		presets: presets.presets,
		defaultPresetId: presets.defaultPresetId,
	};
}

function writeProfile(sdk: PluginSdk, data: ProfileData): void {
	workspacesStore(sdk).set({ workspaces: [...data.workspaces], activeId: data.activeWorkspaceId });
	workSessionsStore(sdk).set({ workSessions: [...data.workSessions] });
	panesStore(sdk).set({ byWorkSession: { ...data.panes } });
	layoutPresetsStore(sdk).set({
		presets: [...data.presets],
		defaultPresetId: data.defaultPresetId,
	});
}

function markAdopted(adoption: KvStore<{ adopted: string[] }>, source: string): void {
	adoption.set({ adopted: [...adoption.snapshot().adopted, source] });
}

function adoptions(sdk: PluginSdk): readonly Adoption[] {
	return [
		{
			source: "kilo.workspaces/workspaces",
			pluginId: "kilo.workspaces",
			namespace: "workspaces",
			adopt: (raw) => {
				const store = workspacesStore(sdk);
				const legacy = readLegacyWorkspaces(raw);
				const own = store.snapshot();
				store.set({
					workspaces: underById(own.workspaces, legacy.workspaces),
					activeId: own.activeId ?? legacy.activeId,
					importedFromOrigin: own.importedFromOrigin || legacy.importedFromOrigin,
				});
			},
		},
		{
			source: "kilo.sessions/sessions",
			pluginId: "kilo.sessions",
			namespace: "sessions",
			adopt: (raw) => {
				const store = workSessionsStore(sdk);
				const legacy = readLegacyWorkSessions(raw);
				const own = store.snapshot();
				store.set({
					workSessions: underById(own.workSessions, legacy.workSessions),
					importedFromOrigin: own.importedFromOrigin || legacy.importedFromOrigin,
					originArchivesReopened: own.originArchivesReopened || legacy.originArchivesReopened,
				});
			},
		},
		{
			source: "kilo.sessions/panes",
			pluginId: "kilo.sessions",
			namespace: "panes",
			adopt: (raw) => {
				const store = panesStore(sdk);
				const legacy = readLegacyPanes(raw);
				store.set({
					byWorkSession: { ...legacy.byWorkSession, ...store.snapshot().byWorkSession },
				});
			},
		},
		{
			source: "kilo.workbench/layouts",
			pluginId: "kilo.workbench",
			namespace: "layouts",
			adopt: (raw) => {
				const store = layoutPresetsStore(sdk);
				const legacy = readLegacyLayoutPresets(raw);
				const own = store.snapshot();
				const presets = underById(own.presets, legacy.presets).slice(0, 100);
				const legacyDefault = presets.some((preset) => preset.id === legacy.defaultPresetId)
					? legacy.defaultPresetId
					: null;
				store.set({
					presets,
					defaultPresetId: own.defaultPresetId ?? legacyDefault,
					importedFromOrigin: own.importedFromOrigin || legacy.importedFromOrigin,
				});
			},
		},
	];
}
