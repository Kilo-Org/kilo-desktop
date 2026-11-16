/** Nested under Kilo session `metadata` for every chat this app creates. */
export const KILO_DESKTOP_METADATA_KEY = "kilo-desktop";
/** The key origin used before the rename; still read. */
const PRE_RENAME_METADATA_KEY = "anaconda";

export interface WorkspaceFolderStamp {
	readonly path: string;
	readonly isPrimary: boolean;
}

export interface KiloDesktopSessionMetadata {
	readonly workspaceId?: string;
	readonly workspaceFolders?: readonly WorkspaceFolderStamp[];
	/** Present when the chat runs in a Kilo-created git worktree. */
	readonly worktree?: { readonly branch: string };
	/** The Work Session the chat was created for. */
	readonly workSessionId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

function readKiloDesktopSessionMetadata(metadata: unknown): Record<string, unknown> | undefined {
	const record = asRecord(metadata);
	if (!record) return undefined;
	return asRecord(record[KILO_DESKTOP_METADATA_KEY]) ?? asRecord(record[PRE_RENAME_METADATA_KEY]);
}

/** The `metadata` a chat is created with; an empty stamp still marks it as this app's. */
export function buildKiloDesktopSessionMetadata(input: {
	readonly workspaceId?: string | undefined;
	readonly workspaceFolders?: readonly WorkspaceFolderStamp[] | undefined;
	readonly worktreeBranch?: string | undefined;
	readonly workSessionId?: string | undefined;
}): { [KILO_DESKTOP_METADATA_KEY]: KiloDesktopSessionMetadata } {
	return {
		[KILO_DESKTOP_METADATA_KEY]: {
			...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
			...(input.workspaceFolders?.length ? { workspaceFolders: input.workspaceFolders } : {}),
			...(input.worktreeBranch ? { worktree: { branch: input.worktreeBranch } } : {}),
			...(input.workSessionId ? { workSessionId: input.workSessionId } : {}),
		},
	};
}

/** True when this app created the chat (Kilo CLI chats are left alone). */
export function hasKiloDesktopSessionMetadata(metadata: unknown): boolean {
	return readKiloDesktopSessionMetadata(metadata) !== undefined;
}

export function readWorkspaceIdFromMetadata(metadata: unknown): string | undefined {
	return asString(readKiloDesktopSessionMetadata(metadata)?.workspaceId);
}

export function readWorkspaceFoldersFromMetadata(metadata: unknown): WorkspaceFolderStamp[] {
	const folders = readKiloDesktopSessionMetadata(metadata)?.workspaceFolders;
	if (!Array.isArray(folders)) return [];
	return folders.flatMap((folder) => {
		const record = asRecord(folder);
		const path = asString(record?.path);
		if (!path || typeof record?.isPrimary !== "boolean") return [];
		return [{ path, isPrimary: record.isPrimary }];
	});
}

export function readWorktreeBranchFromMetadata(metadata: unknown): string | undefined {
	return asString(asRecord(readKiloDesktopSessionMetadata(metadata)?.worktree)?.branch);
}

export function readWorkSessionIdFromMetadata(metadata: unknown): string | undefined {
	return asString(readKiloDesktopSessionMetadata(metadata)?.workSessionId);
}
