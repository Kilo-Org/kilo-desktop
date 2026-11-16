/** The last segment of a path, on either separator; the path itself when it has none. */
export function directoryBasename(directory: string): string {
	const segments = directory.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] ?? directory;
}
