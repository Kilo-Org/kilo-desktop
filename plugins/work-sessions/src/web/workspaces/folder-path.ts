/** Joins with the separator `parent` already uses (parents come from the OS picker). */
export function joinFolderPath(parent: string, child: string): string {
	const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

/**
 * Why `name` can't be one new folder's name, or null when it can. The name is
 * joined onto the chosen location, so a separator or `..` would put the
 * folder somewhere else; main refuses those too.
 */
export function folderNameProblem(name: string): string | null {
	if (name === "." || name === "..") return `"${name}" can't be used as a folder name.`;
	if (/[\\/]/.test(name)) return "A folder name can't contain / or \\.";
	return null;
}
