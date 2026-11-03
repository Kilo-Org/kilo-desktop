export const DEFAULT_EXPLORER_TITLE = "Files";

export function folderName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/u, "");
	return trimmed.split(/[\\/]/u).at(-1) || path;
}

export function explorerRootTitle(
	workspaceDirectory: string | undefined,
	workspaceFolders: readonly { readonly path: string }[] = [],
): string {
	if (!workspaceDirectory) return DEFAULT_EXPLORER_TITLE;
	const name = folderName(workspaceDirectory);
	const collisions = workspaceFolders.filter((folder) => folderName(folder.path) === name);
	return collisions.length > 1 ? workspaceDirectory : name;
}
