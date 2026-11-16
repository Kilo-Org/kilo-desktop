import {
	resolvePathInFolders,
	type WorkSessionFolder,
} from "@kilo-desktop/plugin-work-sessions/contracts";

/**
 * The absolute path to open for a changed file, or null when it can't be
 * opened: patch paths are relative to the repository's top level, which may
 * sit above the work session's folders, and only files inside them are
 * authorized. The path keeps the folder's separator style.
 */
export function fileOpenTarget(
	repositoryPath: string,
	topLevelWorkingDirectory: string,
	folders: readonly WorkSessionFolder[],
): string | null {
	const resolved = resolvePathInFolders(folders, `${topLevelWorkingDirectory}/${repositoryPath}`);
	if (!resolved?.relativePath) return null;
	const { workspaceDirectory, relativePath } = resolved;
	const separator = workspaceDirectory.includes("\\") ? "\\" : "/";
	return `${workspaceDirectory.replace(/[\\/]+$/, "")}${separator}${relativePath.replaceAll("/", separator)}`;
}
