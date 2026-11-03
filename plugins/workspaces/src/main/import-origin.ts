import { existsSync } from "node:fs";

import { normalizeWorkspaceIdentityColor, type Workspace } from "../contracts";

interface OriginWorkspaceRow {
	readonly id: string;
	readonly name: string;
	readonly color: string | null;
	readonly created_at: number;
	readonly updated_at: number;
}

interface OriginFolderRow {
	readonly id: string;
	readonly workspace_id: string;
	readonly path: string;
	readonly is_primary: number;
	readonly position: number;
}

/**
 * Reads the workspaces origin kept in kilo-ui's SQLite database, read-only.
 * Returns [] when the file is absent; throws when it can't be read (the caller
 * logs it). better-sqlite3 loads lazily: it is only needed for this one-time
 * import, and a native build that doesn't match must not break activation.
 */
export async function readOriginWorkspaces(file: string): Promise<Workspace[]> {
	if (!existsSync(file)) return [];
	const { default: Database } = await import("better-sqlite3");
	const db = new Database(file, { readonly: true, fileMustExist: true });
	try {
		const workspaces = db
			.prepare("SELECT id, name, color, created_at, updated_at FROM workspaces")
			.all() as OriginWorkspaceRow[];
		const folders = db
			.prepare(
				"SELECT id, workspace_id, path, is_primary, position FROM workspace_folders ORDER BY position",
			)
			.all() as OriginFolderRow[];
		return workspaces.map((row) => {
			const color = normalizeWorkspaceIdentityColor(row.color) ?? undefined;
			return {
				id: row.id,
				name: row.name,
				...(color ? { color } : {}),
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				folders: folders
					.filter((folder) => folder.workspace_id === row.id)
					.map((folder) => ({
						id: folder.id,
						path: folder.path,
						isPrimary: folder.is_primary === 1,
						position: folder.position,
					})),
			};
		});
	} finally {
		db.close();
	}
}
