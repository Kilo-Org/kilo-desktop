/**
 * Whether new sessions in a workspace start in a new worktree or the local
 * checkout, remembered per workspace in this device's localStorage. A
 * workspace without its own choice starts from origin's last-chosen mode
 * (`git.draftMode:v1`, one value for every workspace). Only an exact
 * "worktree" selects worktrees, so corrupt storage falls back to local.
 */
export const ISOLATION_PREFERENCE_STORAGE_KEY = "kilo.workbench.isolation:v1";
export const ORIGIN_DRAFT_MODE_STORAGE_KEY = "git.draftMode:v1";

export type IsolationMode = "local" | "worktree";

function storage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function parse(raw: string | null | undefined): unknown {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function readAll(): Record<string, unknown> {
	const value = parse(storage()?.getItem(ISOLATION_PREFERENCE_STORAGE_KEY));
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function readIsolationMode(workspaceId: string): IsolationMode {
	const own = readAll()[workspaceId];
	const mode = own ?? parse(storage()?.getItem(ORIGIN_DRAFT_MODE_STORAGE_KEY));
	return mode === "worktree" ? "worktree" : "local";
}

export function rememberIsolationMode(workspaceId: string, mode: IsolationMode): void {
	try {
		storage()?.setItem(
			ISOLATION_PREFERENCE_STORAGE_KEY,
			JSON.stringify({ ...readAll(), [workspaceId]: mode }),
		);
	} catch {
		// A full or unavailable storage only forgets the choice.
	}
}
