/** The last path segment of a native path, falling back to the whole path. */
export function folderName(path: string): string {
	const withoutTrailingSeparators = path.replace(/[\\/]+$/u, "");
	return withoutTrailingSeparators.split(/[\\/]/u).at(-1) || path;
}
