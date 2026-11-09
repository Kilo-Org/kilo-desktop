// Derived from Pierre's diffshub (apps/diffshub/lib/diffsHubDataAccumulator.ts), Copyright 2025 Pierre Computer Company,
// Apache-2.0. Modified for Kilo Desktop; see THIRD_PARTY_NOTICES.md.

import type { ChangeTypes, CodeViewItem, FileDiffMetadata } from "@pierre/diffs";
import type { FileTreeGitStatusPatch, GitStatusEntry } from "@pierre/trees";

import { mapChangeTypeToGitStatus } from "./map-change-type-to-git-status.js";

/** Header stats: file count and added/deleted line totals. */
export interface GitDiffStats {
	addedLines: number;
	deletedLines: number;
	fileCount: number;
}

/**
 * One snapshot of tree input, linked to the previous snapshot it extends.
 * The link is absent on the first snapshot and on the first snapshot after
 * the accumulator renames an already-published path, forcing a full reset.
 */
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
	pathIndex: number;
	sawDeleted: boolean;
	// Usually the patch path; suffixed when a directory claims that path.
	treePath: string;
}

export interface GitDiffDataAccumulator {
	diffStats: GitDiffStats;
	directoryPaths: Set<string>;
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
	pathStateByPatchPath: Map<string, CodeViewPathState>;
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
		directoryPaths: new Set(),
		gitStatusByPath: new Map(),
		items: [],
		lastTreeSource: undefined,
		nextCollisionSuffixByBase: new Map(),
		pendingGitStatusRemovePaths: new Set(),
		pendingGitStatusSetByPath: new Map(),
		pendingItems: [],
		pendingItemById: new Map(),
		pathToItemId: new Map(),
		pathStateByPatchPath: new Map(),
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
		path.length === 0 ? undefined : accumulator.pathStateByPatchPath.get(path);
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

	let pathState = previousPathState;
	if (pathState == null) {
		const treePath = claimTreePath(accumulator, path);
		pathState = {
			currentItem: item,
			currentItemId: id,
			currentType: fileDiff.type,
			pathIndex: accumulator.paths.length,
			sawDeleted: false,
			treePath,
		};
		accumulator.paths.push(treePath);
		accumulator.pathStateByPatchPath.set(path, pathState);
		accumulator.pathStateByTreePath.set(treePath, pathState);
	}
	const { treePath } = pathState;
	accumulator.usedItemIds.add(id);
	accumulator.pathToItemId.set(treePath, id);
	updateGitStatusByPath(accumulator, treePath, fileDiff.type, pathState.sawDeleted);
	pathState.currentItem = item;
	pathState.currentItemId = id;
	pathState.currentType = fileDiff.type;
	pathState.sawDeleted ||= fileDiff.type === "deleted";

	return itemIdRename;
}

// Picks the tree path for a patch path seen for the first time. The tree
// cannot hold a file and a directory at the same path, yet a patch can (a
// deleted symlink `lib/actions` next to an added `lib/actions/index.ts`).
// The directory always keeps its real path; the file gets a suffixed name,
// so an already-placed file that a later patch path turns into a directory
// is renamed.
function claimTreePath(accumulator: GitDiffDataAccumulator, patchPath: string): string {
	const { directoryPaths, pathStateByTreePath } = accumulator;
	// Ancestors are visited deepest-first, so reaching a known directory means
	// every shallower ancestor is already a directory too.
	let slashIndex = patchPath.lastIndexOf("/");
	while (slashIndex > 0) {
		const directoryPath = patchPath.slice(0, slashIndex);
		if (directoryPaths.has(directoryPath)) break;
		const fileState = pathStateByTreePath.get(directoryPath);
		if (fileState != null) renameTreeFile(accumulator, fileState);
		directoryPaths.add(directoryPath);
		slashIndex = patchPath.lastIndexOf("/", slashIndex - 1);
	}

	return directoryPaths.has(patchPath) || pathStateByTreePath.has(patchPath)
		? createFileTreePath(accumulator, patchPath)
		: patchPath;
}

// Moves a file already in the tree to a suffixed path, carrying its item link
// and git status. Published snapshots alias `paths` and `pathToItemId`, so
// renaming a file the last snapshot already shows first copies both and drops
// the snapshot link: the next snapshot is unlinked and the sidebar rebuilds
// in patch order instead of extending a tree that still holds the old path.
function renameTreeFile(accumulator: GitDiffDataAccumulator, pathState: CodeViewPathState): void {
	const { lastTreeSource } = accumulator;
	if (lastTreeSource != null && pathState.pathIndex < lastTreeSource.pathCount) {
		accumulator.paths = accumulator.paths.slice();
		accumulator.pathToItemId = new Map(accumulator.pathToItemId);
		accumulator.lastTreeSource = undefined;
	}

	const { gitStatusByPath, pathStateByTreePath, pathToItemId } = accumulator;
	const from = pathState.treePath;
	const to = createFileTreePath(accumulator, from);
	pathState.treePath = to;
	accumulator.paths[pathState.pathIndex] = to;
	pathStateByTreePath.delete(from);
	pathStateByTreePath.set(to, pathState);
	pathToItemId.delete(from);
	pathToItemId.set(to, pathState.currentItemId);

	const gitStatusEntry = gitStatusByPath.get(from);
	if (gitStatusEntry != null) {
		gitStatusByPath.delete(from);
		recordGitStatusRemove(accumulator, from);
		const renamedEntry = { path: to, status: gitStatusEntry.status };
		gitStatusByPath.set(to, renamedEntry);
		recordGitStatusSet(accumulator, renamedEntry);
	}
}

// Returns an unused tree path for a file whose own path is taken by a
// directory (or by another file that was already renamed).
function createFileTreePath(accumulator: GitDiffDataAccumulator, path: string): string {
	const { directoryPaths, pathStateByTreePath } = accumulator;
	let treePath = `${path} (file)`;
	let suffix = 2;
	while (directoryPaths.has(treePath) || pathStateByTreePath.has(treePath)) {
		treePath = `${path} (file ${suffix})`;
		suffix++;
	}
	return treePath;
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
	patchPath: string,
	pathState: CodeViewPathState,
): GitDiffItemIdRename | undefined {
	const oldId = pathState.currentItemId;
	// Freeing the old id first (upstream re-keys its itemIdToFile map the
	// same way) lets the newest entry for this path re-take the canonical
	// tree id, so navigation stays path-stable without rebuilding.
	accumulator.usedItemIds.delete(oldId);
	const newId = createSupersededItemId(accumulator, patchPath, pathState.currentType);
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
	patchPath: string,
	changeType: ChangeTypes,
): string {
	const semanticSuffix = changeType === "deleted" ? "?deleted" : "?previous";
	return createUniqueItemId(accumulator, `${patchPath}${semanticSuffix}`);
}

function createFallbackItemId(accumulator: GitDiffDataAccumulator, patchPath: string): string {
	return createUniqueItemId(accumulator, `${patchPath}?2`);
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
