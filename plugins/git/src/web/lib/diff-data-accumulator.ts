import type { ChangeTypes, CodeViewItem, FileDiffMetadata } from "@pierre/diffs";
import type { FileTreeGitStatusPatch, GitStatusEntry } from "@pierre/trees";

import { mapChangeTypeToGitStatus } from "./map-change-type-to-git-status.js";

/** Header stats: file count and added/deleted line totals. */
export interface GitDiffStats {
	addedLines: number;
	deletedLines: number;
	fileCount: number;
}

/** One snapshot of tree input, linked to the previous snapshot it extends. */
export interface GitDiffTreeSource {
	gitStatus: GitStatusEntry[];
	gitStatusPatch: FileTreeGitStatusPatch | undefined;
	pathCount: number;
	paths: string[];
	pathToItemId: Map<string, string>;
	previousSource: GitDiffTreeSource | undefined;
}

export interface GitDiffItemIdRename {
	oldId: string;
	newId: string;
}

interface CodeViewPathState {
	currentItem: CodeViewItem<undefined>;
	currentItemId: string;
	currentType: ChangeTypes;
	sawDeleted: boolean;
}

export interface GitDiffDataAccumulator {
	diffStats: GitDiffStats;
	gitStatusByPath: Map<string, GitStatusEntry>;
	items: CodeViewItem<undefined>[];
	// The last tree source emitted by snapshotGitDiffTreeSource for this
	// accumulator. Each new snapshot links back to this so the consumer can
	// recognize append-only growth and skip the full PathStore rebuild.
	lastTreeSource: GitDiffTreeSource | undefined;
	nextCollisionSuffixByBase: Map<string, number>;
	pendingGitStatusRemovePaths: Set<string>;
	pendingGitStatusSetByPath: Map<string, GitStatusEntry>;
	pendingItems: CodeViewItem<undefined>[];
	pendingItemById: Map<string, CodeViewItem<undefined>>;
	pathToItemId: Map<string, string>;
	pathStateByTreePath: Map<string, CodeViewPathState>;
	paths: string[];
	// Every item id ever issued, including superseded ones. Upstream
	// diffshub tracks this as the keys of its `itemIdToFile` map (which
	// also powers its comment sidebar); we need only the keys.
	usedItemIds: Set<string>;
}

export function createGitDiffDataAccumulator(): GitDiffDataAccumulator {
	return {
		diffStats: { addedLines: 0, deletedLines: 0, fileCount: 0 },
		gitStatusByPath: new Map(),
		items: [],
		lastTreeSource: undefined,
		nextCollisionSuffixByBase: new Map(),
		pendingGitStatusRemovePaths: new Set(),
		pendingGitStatusSetByPath: new Map(),
		pendingItems: [],
		pendingItemById: new Map(),
		pathToItemId: new Map(),
		pathStateByTreePath: new Map(),
		paths: [],
		usedItemIds: new Set(),
	};
}

export function appendFileDiffToGitDiffData(
	accumulator: GitDiffDataAccumulator,
	fileDiff: FileDiffMetadata,
): GitDiffItemIdRename | undefined {
	const { diffStats } = accumulator;
	diffStats.fileCount++;
	for (const hunk of fileDiff.hunks) {
		diffStats.addedLines += hunk.additionLines;
		diffStats.deletedLines += hunk.deletionLines;
	}

	const path = fileDiff.name;
	const previousPathState =
		path.length === 0 ? undefined : accumulator.pathStateByTreePath.get(path);
	const itemIdRename =
		previousPathState == null
			? undefined
			: renameCurrentPathItem(accumulator, path, previousPathState);
	const id = accumulator.usedItemIds.has(path) ? createFallbackItemId(accumulator, path) : path;

	const item: CodeViewItem<undefined> = {
		id,
		type: "diff",
		fileDiff,
		version: 0,
	};
	accumulator.items.push(item);
	accumulator.pendingItems.push(item);
	accumulator.pendingItemById.set(id, item);

	if (path.length === 0) {
		return itemIdRename;
	}

	if (previousPathState == null) {
		accumulator.paths.push(path);
	}
	accumulator.usedItemIds.add(id);
	accumulator.pathToItemId.set(path, id);
	updateGitStatusByPath(accumulator, path, fileDiff.type, previousPathState?.sawDeleted === true);
	accumulator.pathStateByTreePath.set(path, {
		currentItem: item,
		currentItemId: id,
		currentType: fileDiff.type,
		sawDeleted: previousPathState?.sawDeleted === true || fileDiff.type === "deleted",
	});

	return itemIdRename;
}

export function takePendingGitDiffItems(
	accumulator: GitDiffDataAccumulator,
): CodeViewItem<undefined>[] {
	const { pendingItems } = accumulator;
	accumulator.pendingItems = [];
	accumulator.pendingItemById.clear();
	return pendingItems;
}

// Produces a tree source snapshot, linking it to the previous snapshot from
// the same accumulator. The consumer treats that link as a hint that the new
// paths array is an append-only extension of the prior one and applies the
// delta with model.batch instead of rebuilding the whole PathStore.
export function snapshotGitDiffTreeSource(accumulator: GitDiffDataAccumulator): GitDiffTreeSource {
	const previousSource = accumulator.lastTreeSource;
	const gitStatusPatch = takePendingGitStatusPatch(accumulator);
	const snapshot: GitDiffTreeSource = {
		gitStatus: Array.from(accumulator.gitStatusByPath.values()),
		gitStatusPatch: previousSource == null ? undefined : gitStatusPatch,
		pathCount: accumulator.paths.length,
		paths: accumulator.paths,
		pathToItemId: accumulator.pathToItemId,
		previousSource,
	};
	accumulator.lastTreeSource = snapshot;
	return snapshot;
}

function takePendingGitStatusPatch(
	accumulator: GitDiffDataAccumulator,
): FileTreeGitStatusPatch | undefined {
	const { pendingGitStatusRemovePaths, pendingGitStatusSetByPath } = accumulator;
	if (pendingGitStatusRemovePaths.size === 0 && pendingGitStatusSetByPath.size === 0) {
		return undefined;
	}

	const patch: FileTreeGitStatusPatch = {};
	if (pendingGitStatusRemovePaths.size > 0) {
		patch.remove = [...pendingGitStatusRemovePaths];
		pendingGitStatusRemovePaths.clear();
	}
	if (pendingGitStatusSetByPath.size > 0) {
		patch.set = [...pendingGitStatusSetByPath.values()];
		pendingGitStatusSetByPath.clear();
	}
	return patch;
}

// Moves the current CodeView item for a path off the canonical tree id so the
// next diff entry for that same path can own tree navigation without
// rebuilding.
function renameCurrentPathItem(
	accumulator: GitDiffDataAccumulator,
	treePath: string,
	pathState: CodeViewPathState,
): GitDiffItemIdRename | undefined {
	const oldId = pathState.currentItemId;
	// Freeing the old id first (upstream re-keys its itemIdToFile map the
	// same way) lets the newest entry for this path re-take the canonical
	// tree id, so navigation stays path-stable without rebuilding.
	accumulator.usedItemIds.delete(oldId);
	const newId = createSupersededItemId(accumulator, treePath, pathState.currentType);
	accumulator.usedItemIds.add(newId);
	pathState.currentItem.id = newId;
	pathState.currentItemId = newId;

	const pendingItem = accumulator.pendingItemById.get(oldId);
	if (pendingItem != null) {
		accumulator.pendingItemById.delete(oldId);
		accumulator.pendingItemById.set(newId, pendingItem);
		return undefined;
	}

	return { oldId, newId };
}

function createSupersededItemId(
	accumulator: GitDiffDataAccumulator,
	treePath: string,
	changeType: ChangeTypes,
): string {
	const semanticSuffix = changeType === "deleted" ? "?deleted" : "?previous";
	return createUniqueItemId(accumulator, `${treePath}${semanticSuffix}`);
}

function createFallbackItemId(accumulator: GitDiffDataAccumulator, treePath: string): string {
	return createUniqueItemId(accumulator, `${treePath}?2`);
}

// Resolves rare id collisions by advancing a per-base suffix instead of
// scanning accumulated items. Checks every issued id (including superseded
// ones), so a real file named like a superseded id can never collide with it.
function createUniqueItemId(accumulator: GitDiffDataAccumulator, baseId: string): string {
	if (!accumulator.usedItemIds.has(baseId)) {
		return baseId;
	}

	let suffix = accumulator.nextCollisionSuffixByBase.get(baseId) ?? 2;
	let itemId = `${baseId}-${suffix}`;
	while (accumulator.usedItemIds.has(itemId)) {
		suffix++;
		itemId = `${baseId}-${suffix}`;
	}
	accumulator.nextCollisionSuffixByBase.set(baseId, suffix + 1);
	return itemId;
}

// Maintains the file tree status for a real path while repeated patch entries
// replace the path's final CodeView item.
function updateGitStatusByPath(
	accumulator: GitDiffDataAccumulator,
	treePath: string,
	changeType: ChangeTypes,
	hadDeletedEntry: boolean,
): void {
	if (hadDeletedEntry && changeType !== "deleted") {
		// Ported diffshub semantics: a path deleted and then reappearing with a
		// non-deleted entry returns to neutral — drop the badge entirely.
		if (accumulator.gitStatusByPath.delete(treePath)) {
			recordGitStatusRemove(accumulator, treePath);
		}
		return;
	}

	// Badges mirror the patch's change types. In a worktree-vs-HEAD patch,
	// untracked files are indistinguishable from staged-new and deliberately
	// show as "added" (product decision), keeping the badges consistent with
	// the diff content by construction.
	const gitStatusEntry = mapChangeTypeToGitStatus(changeType);
	const previousStatus = accumulator.gitStatusByPath.get(treePath)?.status;
	if (previousStatus === gitStatusEntry) return;
	const entry = { path: treePath, status: gitStatusEntry };
	accumulator.gitStatusByPath.set(treePath, entry);
	recordGitStatusSet(accumulator, entry);
}

function recordGitStatusSet(accumulator: GitDiffDataAccumulator, entry: GitStatusEntry): void {
	accumulator.pendingGitStatusRemovePaths.delete(entry.path);
	accumulator.pendingGitStatusSetByPath.set(entry.path, entry);
}

function recordGitStatusRemove(accumulator: GitDiffDataAccumulator, path: string): void {
	accumulator.pendingGitStatusSetByPath.delete(path);
	accumulator.pendingGitStatusRemovePaths.add(path);
}
