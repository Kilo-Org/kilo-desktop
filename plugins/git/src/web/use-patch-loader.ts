import { type CodeViewItem, processFile } from "@pierre/diffs";
import { type CodeViewHandle, useStableCallback } from "@pierre/diffs/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
	appendFileDiffToGitDiffData,
	createGitDiffDataAccumulator,
	snapshotGitDiffTreeSource,
	takePendingGitDiffItems,
} from "./lib/diff-data-accumulator.js";
import { createPatchFileCacheKey } from "./lib/patch-cache-key.js";
import { streamGitPatchFiles } from "./lib/stream-git-patch-files.js";
import type { GitDiffStats, GitDiffTreeSource } from "./lib/diff-data-accumulator.js";

const STREAM_PUBLISH_INTERVAL_MS = 100;
const STREAM_WORK_BUDGET_MS = 8;
const STREAM_TREE_PUBLISH_FILE_BATCH_SIZE = 1_000;
const STREAM_TREE_PUBLISH_INTERVAL_MS = 1_000;
const CODE_VIEW_BATCH_COUNT = 25;
const GENERIC_PATCH_LOAD_ERROR_MESSAGE = "The working directory diff could not be loaded.";

/** Carries the failed request's HTTP status so the UI can tailor error copy. */
class PatchRequestError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export type PatchLoadState = "fetching" | "streaming" | "ready" | "error";

export interface UsePatchLoaderOptions {
	collapseMode: "expanded" | "collapsed";
	/** Absolute workspace directory the diff is generated for. */
	workspaceDirectory: string;
	viewerRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
}

export interface UsePatchLoaderResult {
	applyCollapseModeToLoaded: (mode: "expanded" | "collapsed") => void;
	diffStats: GitDiffStats | null;
	/** HTTP status of the failed request, or null for non-HTTP failures. */
	errorStatus: number | null;
	errorMessage: string | null;
	expandItem: (itemId: string) => void;
	initialItems: CodeViewItem<undefined>[];
	loadState: PatchLoadState;
	retryLoad: () => void;
	toggleItemCollapsed: (itemId: string) => void;
	treeSource: GitDiffTreeSource | null;
	viewerKey: number;
}

/**
 * Fetches `kilo-git://diff/patch?cwd=…` and streams the patch into the
 * CodeView imperatively (`initialItems` + `addItems`), the tree, and the
 * stats.
 *
 * Raw `fetch` + `AbortController` is deliberate, not an oversight: the
 * response body is consumed progressively as files stream in, which
 * `useSdkQuery`'s resolve-once model cannot express. The AbortController
 * also keeps the effect safe under StrictMode double-invoke and tab remounts.
 *
 * Adapted from diffshub's `usePatchLoader` (no GitHub token, no line-hash
 * deep links). Transient values (requestId, loadedItemIds, collapseMode)
 * live in refs by design so the long-lived streaming closure reads live
 * state without re-binding. The supersession guards on `appendStreamedFile`
 * are not upstream — do not drop on re-sync (diffshub has the same race).
 */
export function usePatchLoader({
	collapseMode,
	workspaceDirectory,
	viewerRef,
}: UsePatchLoaderOptions): UsePatchLoaderResult {
	const [initialItems, setInitialItems] = useState<CodeViewItem<undefined>[]>([]);
	const [treeSource, setTreeSource] = useState<GitDiffTreeSource | null>(null);
	const [diffStats, setDiffStats] = useState<GitDiffStats | null>(null);
	const [loadState, setLoadState] = useState<PatchLoadState>("fetching");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [errorStatus, setErrorStatus] = useState<number | null>(null);
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [viewerKey, setViewerKey] = useState(0);
	const requestIdRef = useRef(0);
	// Tracks the ids of every item handed to the viewer so bulk collapse
	// updates can walk the full set; the handle exposes no enumeration API.
	const loadedItemIdsRef = useRef<Set<string>>(new Set());
	// Mirrors the live collapse mode so the streaming closure reads it
	// without us re-binding the effect on every change.
	const collapseModeRef = useRef(collapseMode);
	collapseModeRef.current = collapseMode;

	// Pre-mutates fresh items so they arrive in the viewer matching the
	// current collapse mode, then records their ids for later bulk updates.
	// Deleted-file diffs initialize collapsed by default, so the overwrite is
	// unconditional — otherwise they would stay collapsed even in expanded
	// mode.
	const prepareItemsForViewer = (items: readonly CodeViewItem<undefined>[]): void => {
		const targetCollapsed = collapseModeRef.current === "collapsed";
		for (const item of items) {
			loadedItemIdsRef.current.add(item.id);
			if (item.type === "diff") {
				item.collapsed = targetCollapsed;
			}
		}
	};

	const applyCollapseModeToLoaded = useStableCallback((mode: "expanded" | "collapsed") => {
		const targetCollapsed = mode === "collapsed";
		const viewer = viewerRef.current;
		if (viewer == null) {
			// The viewer has not mounted yet. Rewrite buffered items so they
			// arrive in the right state once it does; items still streaming in
			// pick up the live mode through prepareItemsForViewer.
			setInitialItems((prev) => {
				let changed = false;
				const next = prev.map((item) => {
					if (item.type !== "diff" || (item.collapsed === true) === targetCollapsed) {
						return item;
					}
					changed = true;
					return { ...item, collapsed: targetCollapsed };
				});
				return changed ? next : prev;
			});
			return;
		}

		for (const itemId of loadedItemIdsRef.current) {
			const item = viewer.getItem(itemId);
			if (item == null || item.type !== "diff") {
				continue;
			}
			const current = item.collapsed === true;
			if (current === targetCollapsed) {
				continue;
			}
			item.collapsed = targetCollapsed;
			item.version = getNextItemVersion(item);
			viewer.updateItem(item);
		}
	});

	// Individual toggles are session-only viewer state (like diffshub): they
	// never touch collapseMode, so bulk toggle still overrides every file and
	// freshly streamed items keep following the global mode.
	const toggleItemCollapsed = useStableCallback((itemId: string) => {
		const viewer = viewerRef.current;
		const instance = viewer?.getInstance();
		const item = viewer?.getItem(itemId);
		if (viewer == null || instance == null || item == null || item.type !== "diff") {
			return;
		}
		// Captured before mutating: if collapsing shrinks the document and the
		// header's top was above the viewport, the collapsed header would jump
		// out of view — re-anchor it at the scroll top instead.
		const itemTop = instance.getTopForItem(itemId);
		item.collapsed = item.collapsed !== true;
		item.version = getNextItemVersion(item);
		if (!viewer.updateItem(item)) {
			return;
		}
		if (itemTop != null && itemTop < instance.getScrollTop()) {
			viewer.scrollTo({ type: "item", id: item.id, align: "start" });
		}
	});

	// Sidebar selection path: expand only (no scroll here — the caller scrolls
	// after), and only when actually collapsed so re-selecting is a no-op.
	const expandItem = useStableCallback((itemId: string) => {
		const viewer = viewerRef.current;
		const item = viewer?.getItem(itemId);
		if (viewer == null || item == null || item.type !== "diff" || item.collapsed !== true) {
			return;
		}
		item.collapsed = false;
		item.version = getNextItemVersion(item);
		viewer.updateItem(item);
	});

	useEffect(() => {
		const controller = new AbortController();
		const requestId = ++requestIdRef.current;
		const isCurrentRequest = () => requestIdRef.current === requestId && !controller.signal.aborted;

		loadedItemIdsRef.current = new Set();
		setViewerKey(requestId);
		setInitialItems([]);
		setTreeSource(null);
		setDiffStats(null);
		setErrorMessage(null);
		setErrorStatus(null);
		setLoadState("fetching");

		async function loadPatch(): Promise<void> {
			try {
				// Deliberately a raw fetch — see the hook doc comment.
				const response = await fetch(
					`kilo-git://diff/patch?cwd=${encodeURIComponent(workspaceDirectory)}`,
					{
						cache: "no-store",
						signal: controller.signal,
					},
				);

				if (!response.ok) {
					const detail = (await response.text()).trim();
					throw new PatchRequestError(
						response.status,
						detail.length > 0 ? detail : `Request failed (${response.status}).`,
					);
				}

				if (response.body == null) {
					throw new Error(GENERIC_PATCH_LOAD_ERROR_MESSAGE);
				}

				setLoadState("streaming");
				await yieldToBrowser();
				if (!isCurrentRequest()) {
					return;
				}

				const accumulator = createGitDiffDataAccumulator();
				let pendingPublishFileCount = 0;
				let pendingTreePublishFileCount = 0;
				let hasPublishedTree = false;
				let hasPublishedInitialItems = false;
				let lastPublishTime = performance.now();
				let lastWorkYieldTime = lastPublishTime;
				let lastTreePublishTime = lastPublishTime;

				const publishTreeSource = () => {
					if (pendingTreePublishFileCount === 0 || !isCurrentRequest()) {
						return;
					}

					pendingTreePublishFileCount = 0;
					hasPublishedTree = true;
					lastTreePublishTime = performance.now();
					setDiffStats({ ...accumulator.diffStats });
					setTreeSource(snapshotGitDiffTreeSource(accumulator));
				};

				const publishPendingData = async () => {
					if (pendingPublishFileCount === 0 || !isCurrentRequest()) {
						return;
					}

					pendingPublishFileCount = 0;
					lastPublishTime = performance.now();
					const pendingItems = takePendingGitDiffItems(accumulator);
					prepareItemsForViewer(pendingItems);
					if (!hasPublishedInitialItems) {
						hasPublishedInitialItems = true;
						publishTreeSource();
						setInitialItems(pendingItems);
					} else {
						const viewer = viewerRef.current;
						if (viewer != null) {
							viewer.addItems(pendingItems);
						} else {
							setInitialItems((prev) => [...prev, ...pendingItems]);
						}
					}
					await yieldToBrowser();
					lastWorkYieldTime = performance.now();
				};

				const publishPendingDataIfNeeded = async () => {
					if (pendingPublishFileCount === 0) {
						return;
					}

					const elapsed = performance.now() - lastPublishTime;
					if (
						pendingPublishFileCount < CODE_VIEW_BATCH_COUNT &&
						elapsed < STREAM_PUBLISH_INTERVAL_MS
					) {
						return;
					}

					await publishPendingData();
				};
				const publishTreeSourceIfNeeded = () => {
					if (pendingTreePublishFileCount === 0) {
						return;
					}

					const elapsed = performance.now() - lastTreePublishTime;
					if (
						hasPublishedTree &&
						pendingTreePublishFileCount < STREAM_TREE_PUBLISH_FILE_BATCH_SIZE &&
						elapsed < STREAM_TREE_PUBLISH_INTERVAL_MS
					) {
						return;
					}

					publishTreeSource();
				};
				const appendStreamedFile = async (fileText: string) => {
					// Supersession guard: the drain loop below keeps handing out
					// buffered files after an abort (fetch's body reader is not
					// wired to the signal), so without this check a mid-stream
					// supersede would run the rename below against the NEW
					// viewer and the NEW loaded-item set. Not upstream — do not
					// drop on a diffshub re-sync.
					if (!isCurrentRequest()) {
						return;
					}
					const fileDiff = processFile(fileText, {
						cacheKey: createPatchFileCacheKey(fileText),
						isGitDiff: true,
					});
					if (fileDiff == null) {
						return;
					}

					const itemIdRename = appendFileDiffToGitDiffData(accumulator, fileDiff);
					if (itemIdRename != null) {
						viewerRef.current?.updateItemId(itemIdRename.oldId, itemIdRename.newId);
						if (loadedItemIdsRef.current.delete(itemIdRename.oldId)) {
							loadedItemIdsRef.current.add(itemIdRename.newId);
						}
					}
					pendingPublishFileCount++;
					pendingTreePublishFileCount++;
					if (performance.now() - lastWorkYieldTime >= STREAM_WORK_BUDGET_MS) {
						await publishPendingData();
					} else {
						await publishPendingDataIfNeeded();
					}
					publishTreeSourceIfNeeded();
				};

				const fallbackPatchContent = await streamGitPatchFiles(response.body, appendStreamedFile);
				if (!isCurrentRequest()) {
					return;
				}

				await publishPendingData();
				publishTreeSource();
				if (fallbackPatchContent != null && fallbackPatchContent.trim().length > 0) {
					throw new Error(GENERIC_PATCH_LOAD_ERROR_MESSAGE);
				}

				setDiffStats({ ...accumulator.diffStats });
				setLoadState("ready");
			} catch (error) {
				if (!isCurrentRequest()) {
					return;
				}
				setErrorMessage(getPatchLoadErrorMessage(error));
				setErrorStatus(error instanceof PatchRequestError ? error.status : null);
				setLoadState("error");
			}
		}

		void loadPatch();

		return () => {
			controller.abort();
		};
	}, [loadAttempt, viewerRef, workspaceDirectory]);

	const retryLoad = useCallback(() => {
		setLoadAttempt((attempt) => attempt + 1);
	}, []);

	return {
		applyCollapseModeToLoaded,
		diffStats,
		errorStatus,
		errorMessage,
		expandItem,
		initialItems,
		loadState,
		retryLoad,
		toggleItemCollapsed,
		treeSource,
		viewerKey,
	};
}

function getNextItemVersion(item: { version?: string | number }): number {
	return typeof item.version === "number" ? item.version + 1 : 1;
}

function getPatchLoadErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== "") {
		return error.message;
	}
	return GENERIC_PATCH_LOAD_ERROR_MESSAGE;
}

function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => {
		let didResolve = false;
		const resolveOnce = () => {
			if (didResolve) {
				return;
			}

			didResolve = true;
			window.clearTimeout(timeout);
			resolve();
		};
		const timeout = window.setTimeout(resolveOnce, 50);
		window.requestAnimationFrame(resolveOnce);
	});
}
