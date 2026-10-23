/**
 * Renderer capability (`sdk.plugins.get("kilo-ui").chatSessionWorkspace`) that
 * tells other plugins which folders a work session may show, and maps an
 * agent-supplied path onto one of them. Pane-opening WebMCP tools in files and
 * git use it so a tool call can only open content inside the calling session's
 * workspace — the same folder set SessionPage hands to pane components. A
 * session's workspace and worktree are stamped on its chat.
 */
import type { Workspace } from "../../../contracts/workspaces/schemas.js";
import type { SessionActivity } from "../activity/session-activity-logic.js";
import type { SessionId } from "../session-identity.js";

export interface SessionWorkspaceFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

export interface ResolvedSessionPath {
	/** The matching folder, exactly as the session lists it. */
	readonly workspaceDirectory: string;
	/** `/`-separated path inside that folder; empty when the path is the folder itself. */
	readonly relativePath: string;
}

export type ChatSessionWorkspaceCapability = {
	getFolders(sessionId: SessionId): readonly SessionWorkspaceFolder[];
	/** Absolute paths, or paths relative to the primary folder. Null when outside every folder. */
	resolvePath(sessionId: SessionId, path: string): ResolvedSessionPath | null;
};

export type ChatSessionWorkspaceCapabilities = {
	readonly chatSessionWorkspace: ChatSessionWorkspaceCapability;
};

const NO_FOLDERS: readonly SessionWorkspaceFolder[] = [];

export function worktreeDirectoryOf(activity: SessionActivity | undefined): string | undefined {
	return activity?.worktreeBranch !== undefined ? activity.directory : undefined;
}

/** A worktree session works in its worktree, which stands in for the primary folder. */
export function withWorktreeFolder<Folder extends SessionWorkspaceFolder>(
	folders: readonly Folder[],
	worktreeDirectory: string | undefined,
): readonly (Folder | SessionWorkspaceFolder)[] {
	if (worktreeDirectory === undefined) return folders;
	return [
		{ path: worktreeDirectory, isPrimary: true },
		...folders.filter((folder) => !folder.isPrimary),
	];
}

function toSlashes(path: string): string {
	return path.replaceAll("\\", "/");
}

function isAbsolute(slashPath: string): boolean {
	return slashPath.startsWith("/") || /^[A-Za-z]:\//u.test(slashPath);
}

/**
 * Collapses `.`, `..`, and repeated separators, and upper-cases a Windows
 * drive letter (drives are case-insensitive); null when `..` climbs above the root.
 */
function normalizeAbsolute(slashPath: string): string | null {
	const root = slashPath.startsWith("/") ? "/" : slashPath.slice(0, 3).toUpperCase();
	const segments: string[] = [];
	for (const segment of slashPath.slice(root.length).split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return root + segments.join("/");
}

function relativeTo(folderPath: string, target: string): string | null {
	if (target === folderPath) return "";
	const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
	return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}

export function resolvePathInFolders(
	folders: readonly SessionWorkspaceFolder[],
	path: string,
): ResolvedSessionPath | null {
	const input = toSlashes(path.trim());
	if (!input) return null;
	const primary = folders.find((folder) => folder.isPrimary) ?? folders[0];
	const candidate = isAbsolute(input) ? input : primary && `${toSlashes(primary.path)}/${input}`;
	const target = candidate ? normalizeAbsolute(candidate) : null;
	if (target === null) return null;

	let best: { resolved: ResolvedSessionPath; depth: number } | undefined;
	for (const folder of folders) {
		const folderPath = normalizeAbsolute(toSlashes(folder.path));
		if (folderPath === null) continue;
		const relativePath = relativeTo(folderPath, target);
		if (relativePath === null || (best && best.depth >= folderPath.length)) continue;
		best = {
			resolved: { workspaceDirectory: folder.path, relativePath },
			depth: folderPath.length,
		};
	}
	return best?.resolved ?? null;
}

export function createChatSessionWorkspaceCapability(sources: {
	/** The session's chat; today a session has at most one. */
	readonly getChatOfSession: (sessionId: SessionId) => string | undefined;
	readonly getChatActivity: (kiloSessionId: string) => SessionActivity | undefined;
	readonly getWorkspaces: () => readonly Workspace[];
}): ChatSessionWorkspaceCapability {
	const getFolders = (sessionId: SessionId): readonly SessionWorkspaceFolder[] => {
		const chatId = sources.getChatOfSession(sessionId);
		const activity = chatId === undefined ? undefined : sources.getChatActivity(chatId);
		const workspace = activity?.workspaceId
			? sources.getWorkspaces().find((candidate) => candidate.id === activity.workspaceId)
			: undefined;
		const folders = withWorktreeFolder(
			workspace?.folders ?? NO_FOLDERS,
			worktreeDirectoryOf(activity),
		);
		return folders.map(({ path, isPrimary }) => ({ path, isPrimary }));
	};
	return {
		getFolders,
		resolvePath: (sessionId, path) => resolvePathInFolders(getFolders(sessionId), path),
	};
}
