/** Joins with the separator `parent` already uses (parents come from the OS picker). */
export function joinFolderPath(parent: string, child: string): string {
	const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}
