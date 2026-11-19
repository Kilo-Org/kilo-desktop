import {
	FileObjectType,
	UrlObjectType,
	workSessionPanesSchema,
	workSessionSchema,
	workspaceSchema,
	type WorkSession,
	type WorkSessionPanes,
	type Workspace,
} from "../../contracts/model";
import { layoutPresetSchema, type LayoutPreset } from "../../contracts/ui/layout-presets";
import type {
	PersistedLayoutPresets,
	PersistedPanes,
	PersistedWorkSessions,
	PersistedWorkspaces,
} from "./stores";

/*
 * Readers for the kv values kilo.workspaces, kilo.sessions and
 * kilo.workbench kept, converted to kilo.work-sessions' vocabulary. Values
 * are read leniently: an entry that doesn't convert is dropped, the rest is
 * kept.
 */

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

function parsed<T>(
	values: readonly unknown[],
	schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): T[] {
	return values.flatMap((value) => {
		const result = schema.safeParse(value);
		return result.success ? [result.data] : [];
	});
}

export function readLegacyWorkspaces(raw: unknown): PersistedWorkspaces {
	const value = isRecord(raw) ? raw : {};
	return {
		workspaces: parsed<Workspace>(listOf(value.workspaces), workspaceSchema),
		activeId: typeof value.activeId === "string" ? value.activeId : null,
		importedFromOrigin: value.importedFromOrigin === true,
		// The predecessors predate the marker, so their imports are checked again.
		originImportVerified: false,
	};
}

const LEGACY_ISOLATION: Readonly<Record<string, WorkSession["isolation"]>> = {
	local: "local",
	"new-worktree": "new-copy",
	"existing-worktree": "existing-copy",
};

/** kilo.sessions' work session: its worktree fields become the copy's. */
function convertWorkSession(raw: unknown): unknown {
	if (!isRecord(raw)) return raw;
	const { worktreeBranch, worktreeCreated, isolation, ...rest } = raw;
	const kind = typeof isolation === "string" ? LEGACY_ISOLATION[isolation] : undefined;
	return {
		...rest,
		branch: typeof worktreeBranch === "string" ? worktreeBranch : null,
		...(kind ? { isolation: kind } : {}),
		...(worktreeCreated === true ? { copyCreated: true } : {}),
	};
}

export function readLegacyWorkSessions(raw: unknown): PersistedWorkSessions {
	const value = isRecord(raw) ? raw : {};
	return {
		workSessions: parsed<WorkSession>(
			listOf(value.sessions).map(convertWorkSession),
			workSessionSchema,
		),
		importedFromOrigin: value.importedFromOrigin === true,
		originImportVerified: false,
		originArchivesReopened: value.originArchivesReopened === true,
	};
}

/** Object types kilo.sessions' openers used, now owned by kilo.work-sessions. */
const LEGACY_OBJECT_TYPES: Readonly<Record<string, string>> = {
	"kilo.workspaces/file": FileObjectType.id,
	"kilo.browser/url": UrlObjectType.id,
};

/** kilo.sessions' openers kept what a pane showed in its metadata; it is the pane's `object` now. */
function convertPane(raw: unknown): unknown {
	if (!isRecord(raw) || !isRecord(raw.metadata)) return raw;
	const { objectType, objectId, ...metadata } = raw.metadata;
	if (typeof objectType !== "string" || typeof objectId !== "string") return raw;
	return {
		...raw,
		metadata,
		object: { type: LEGACY_OBJECT_TYPES[objectType] ?? objectType, id: objectId },
	};
}

export function readLegacyPanes(raw: unknown): PersistedPanes {
	const bySession = isRecord(raw) && isRecord(raw.bySession) ? raw.bySession : {};
	const byWorkSession: Record<string, WorkSessionPanes> = {};
	for (const [workSessionId, entry] of Object.entries(bySession)) {
		if (!isRecord(entry)) continue;
		const panes = listOf(entry.panes).map(convertPane);
		const result = workSessionPanesSchema.safeParse({ ...entry, panes });
		if (result.success) byWorkSession[workSessionId] = result.data;
	}
	return { byWorkSession };
}

export function readLegacyLayoutPresets(raw: unknown): PersistedLayoutPresets {
	const value = isRecord(raw) ? raw : {};
	const presets = parsed<LayoutPreset>(listOf(value.presets), layoutPresetSchema).slice(0, 100);
	const defaultPresetId =
		typeof value.defaultPresetId === "string" &&
		presets.some((preset) => preset.id === value.defaultPresetId)
			? value.defaultPresetId
			: null;
	return { presets, defaultPresetId, importedFromOrigin: value.importedFromOrigin === true };
}

/** `upper`'s entries, then `lower`'s whose id `upper` doesn't have. */
export function underById<T extends { readonly id: string }>(
	upper: readonly T[],
	lower: readonly T[],
): T[] {
	const ids = new Set(upper.map((entry) => entry.id));
	return [...upper, ...lower.filter((entry) => !ids.has(entry.id))];
}
