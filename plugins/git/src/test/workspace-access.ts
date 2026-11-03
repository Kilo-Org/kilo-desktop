import { isAbsolute, relative, sep } from "node:path";

import type { WorkspaceAccess } from "../main/git-service.js";

/** Workspaces holding `paths`, authorising lexically (no symlinks to resolve in fakes). */
export function folders(...paths: string[]): WorkspaceAccess {
	return {
		authorize: async (directory) =>
			paths.some((folder) => {
				const inside = relative(folder, directory);
				return (
					inside === "" ||
					(inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
				);
			}),
		folderPaths: async () => paths,
	};
}

/** Workspaces that are unavailable. */
export function absentFolders(): WorkspaceAccess {
	return { authorize: async () => null, folderPaths: async () => null };
}
