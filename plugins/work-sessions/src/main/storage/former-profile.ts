import { readFile } from "node:fs/promises";
import path from "node:path";

import {
	workSessionPanesSchema,
	workSessionSchema,
	workspaceSchema,
	type WorkSession,
	type WorkSessionPanes,
	type Workspace,
} from "../../contracts/model";
import { layoutPresetSchema, type LayoutPreset } from "../../contracts/ui/layout-presets";
import { isRecord, listOf, parsed, underById } from "./legacy";
import {
	LAYOUT_PRESETS_NAMESPACE,
	PANES_NAMESPACE,
	WORK_SESSIONS_NAMESPACE,
	WORKSPACES_NAMESPACE,
} from "./stores";

/*
 * What this plugin saved in a profile that was merged into the current one
 * (Preview's own, before Preview and Stable shared a profile), read in this
 * plugin's current format and merged beneath the current profile's data.
 */

export interface ProfileData {
	readonly workspaces: readonly Workspace[];
	readonly activeWorkspaceId: string | null;
	readonly workSessions: readonly WorkSession[];
	readonly panes: Readonly<Record<string, WorkSessionPanes>>;
	readonly presets: readonly LayoutPreset[];
	readonly defaultPresetId: string | null;
}

/** A missing or corrupt file reads as empty; any other failure throws, to be retried. */
export async function readFormerProfile(dir: string): Promise<ProfileData> {
	const read = async (namespace: string): Promise<Readonly<Record<string, unknown>>> => {
		let text: string;
		try {
			text = await readFile(path.join(dir, `${namespace}.json`), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
		try {
			const value: unknown = JSON.parse(text);
			return isRecord(value) ? value : {};
		} catch {
			return {};
		}
	};
	const workspaces = await read(WORKSPACES_NAMESPACE);
	const workSessions = await read(WORK_SESSIONS_NAMESPACE);
	const panes = await read(PANES_NAMESPACE);
	const presets = await read(LAYOUT_PRESETS_NAMESPACE);

	const byWorkSession: Record<string, WorkSessionPanes> = {};
	for (const [workSessionId, entry] of Object.entries(
		isRecord(panes.byWorkSession) ? panes.byWorkSession : {},
	)) {
		const result = workSessionPanesSchema.safeParse(entry);
		if (result.success) byWorkSession[workSessionId] = result.data;
	}
	return {
		workspaces: parsed<Workspace>(listOf(workspaces.workspaces), workspaceSchema),
		activeWorkspaceId: typeof workspaces.activeId === "string" ? workspaces.activeId : null,
		workSessions: parsed<WorkSession>(listOf(workSessions.workSessions), workSessionSchema),
		panes: byWorkSession,
		presets: parsed<LayoutPreset>(listOf(presets.presets), layoutPresetSchema),
		defaultPresetId: typeof presets.defaultPresetId === "string" ? presets.defaultPresetId : null,
	};
}

const folderKey = (workspace: Workspace) =>
	workspace.folders
		.map((folder) => folder.path)
		.sort()
		.join("\n");

/**
 * `former` beneath `own`. Both profiles were used independently, so the same
 * project may have its own workspace in each: a workspace with the same
 * folders folds into the current one and its work sessions follow. A work
 * session in both (a chat stamped with it was adopted here too) keeps the
 * newer copy; one whose chats all belong to a work session here already is a
 * duplicate and is dropped, so every chat stays in one work session.
 */
export function mergeProfiles(own: ProfileData, former: ProfileData): ProfileData {
	const ownIds = new Set(own.workspaces.map((workspace) => workspace.id));
	const ownByFolders = new Map(
		own.workspaces.map((workspace) => [folderKey(workspace), workspace.id]),
	);
	const workspaceIds = new Map<string, string>();
	const addedWorkspaces: Workspace[] = [];
	for (const workspace of former.workspaces) {
		if (ownIds.has(workspace.id)) continue;
		const same = ownByFolders.get(folderKey(workspace));
		if (same) workspaceIds.set(workspace.id, same);
		else addedWorkspaces.push(workspace);
	}
	const workspaces = [...own.workspaces, ...addedWorkspaces];
	const knownWorkspace = (id: string | null) => {
		const mapped = id === null ? null : (workspaceIds.get(id) ?? id);
		return mapped !== null && workspaces.some((workspace) => workspace.id === mapped)
			? mapped
			: null;
	};

	const formerById = new Map(former.workSessions.map((session) => [session.id, session]));
	const workSessions = own.workSessions.map((session) => {
		const copy = formerById.get(session.id);
		if (!copy || copy.updatedAt <= session.updatedAt) return session;
		return {
			...copy,
			workspaceId: knownWorkspace(copy.workspaceId),
			chatIds: [...new Set([...session.chatIds, ...copy.chatIds])],
		};
	});
	const ownSessionIds = new Set(own.workSessions.map((session) => session.id));
	const heldChats = new Set(workSessions.flatMap((session) => session.chatIds));
	const added: WorkSession[] = [];
	for (const session of former.workSessions) {
		if (ownSessionIds.has(session.id)) continue;
		const chatIds = session.chatIds.filter((chatId) => !heldChats.has(chatId));
		if (session.chatIds.length > 0 && chatIds.length === 0) continue;
		added.push({ ...session, workspaceId: knownWorkspace(session.workspaceId), chatIds });
	}

	const panes: Record<string, WorkSessionPanes> = {};
	for (const session of added) {
		const entry = former.panes[session.id];
		if (entry) panes[session.id] = entry;
	}

	const presets = underById(own.presets, former.presets).slice(0, 100);
	const formerDefault = presets.some((preset) => preset.id === former.defaultPresetId)
		? former.defaultPresetId
		: null;
	return {
		workspaces,
		activeWorkspaceId: own.activeWorkspaceId ?? knownWorkspace(former.activeWorkspaceId),
		workSessions: [...workSessions, ...added],
		panes: { ...panes, ...own.panes },
		presets,
		defaultPresetId: own.defaultPresetId ?? formerDefault,
	};
}
