import type { FileTree, FileTreeVisibleRow } from "@pierre/trees";

/**
 * The expanded-directory paths a tree reset should restore, derived from the
 * currently visible rows. Flattened rows (`flattenEmptyDirectories`) carry
 * the real canonical directory paths of their chain in `flattenedSegments`,
 * so those are captured instead of the row's own path.
 */
export function expandedDirectoryPaths(rows: readonly FileTreeVisibleRow[]): string[] {
	const paths: string[] = [];
	for (const row of rows) {
		if (row.kind !== "directory" || !row.isExpanded) continue;
		if (row.flattenedSegments) {
			for (const segment of row.flattenedSegments) paths.push(segment.path);
		} else {
			paths.push(row.path);
		}
	}
	return paths;
}

export function captureExpandedPaths(model: FileTree): string[] {
	return expandedDirectoryPaths(model.getVisibleRows(0, model.getVisibleCount()));
}
