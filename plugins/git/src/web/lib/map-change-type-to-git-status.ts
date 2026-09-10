import type { ChangeTypes } from "@pierre/diffs";
import type { GitStatus } from "@pierre/trees";

/**
 * Translates the diff-level change type surfaced by `@pierre/diffs` into the
 * git-status vocabulary the file tree understands. Both rename variants fold
 * into "renamed" so the tree shows a consistent rename badge regardless of
 * whether content also changed.
 *
 * Ported from diffshub (`mapChangeTypeToGitStatus.ts`). No default case on
 * purpose: the switch is exhaustive over `ChangeTypes`, so a new pierre
 * member fails `tsc` here instead of silently falling through.
 */
export function mapChangeTypeToGitStatus(type: ChangeTypes): GitStatus {
	switch (type) {
		case "new":
			return "added";
		case "deleted":
			return "deleted";
		case "rename-pure":
		case "rename-changed":
			return "renamed";
		case "change":
			return "modified";
	}
}
