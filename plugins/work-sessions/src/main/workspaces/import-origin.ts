import { normalizeWorkspaceIdentityColor, type Workspace } from "../../contracts/model";
import { readOriginDatabase, type SqliteLoader } from "../origin-database";

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
 * Returns [] when the file is absent or unusable; throws when it can't be
 * read now, better-sqlite3 not loading included (the caller retries).
 */
export async function readOriginWorkspaces(
	file: string,
	loadDriver?: SqliteLoader,
): Promise<Workspace[]> {
	const workspaces = await readOriginDatabase(
		file,
		(db) => {
			const rows = db
				.prepare("SELECT id, name, color, created_at, updated_at FROM workspaces")
				.all() as OriginWorkspaceRow[];
			const folders = db
				.prepare(
					"SELECT id, workspace_id, path, is_primary, position FROM workspace_folders ORDER BY position",
				)
				.all() as OriginFolderRow[];
			return rows.map((row): Workspace => {
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
		},
		loadDriver,
	);
	return workspaces ?? [];
}
