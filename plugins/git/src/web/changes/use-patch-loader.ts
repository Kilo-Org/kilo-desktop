// Derived from Pierre's diffshub (apps/diffshub/components/usePatchLoader.ts), Copyright 2025 Pierre Computer Company,
// Apache-2.0. Modified for Kilo Desktop; see THIRD_PARTY_NOTICES.md.

import { type CodeViewItem, processFile } from "@pierre/diffs";
import { type CodeViewHandle, useStableCallback } from "@pierre/diffs/react";
import useLatest from "react-use/esm/useLatest.js";
import { useEffect, useRef, useState, type RefObject } from "react";

import { PATCH_BYTE_LENGTH_HEADER } from "../../contracts";
import {
	appendFileDiffToGitDiffData,
	createGitDiffDataAccumulator,
	snapshotGitDiffTreeSource,
	takePendingGitDiffItems,
} from "./lib/diff-data-accumulator";
import { createPatchFileCacheKey } from "./lib/patch-cache-key";
import { streamGitPatchFiles } from "./lib/stream-git-patch-files";
import { Throttler } from "./lib/throttler";
import type { GitDiffStats, GitDiffTreeSource } from "./lib/diff-data-accumulator";

const STREAM_PUBLISH_INTERVAL_MS = 100;
const STREAM_WORK_BUDGET_MS = 8;
const STREAM_TREE_PUBLISH_FILE_BATCH_SIZE = 1_000;
const STREAM_TREE_PUBLISH_INTERVAL_MS = 1_000;
const CODE_VIEW_BATCH_COUNT = 25;
const GENERIC_PATCH_LOAD_ERROR_MESSAGE = "The working directory diff could not be loaded.";

/** Carries the failed request's HTTP status so the UI can tailor error copy. */
class PatchRequestError extends Error {
	readonly status: number;
	/** The oversized patch's byte length, reported only on a 413. */
	readonly patchByteLength: number | null;

	constructor(status: number, message: string, patchByteLength: number | null = null) {
		super(message);
		this.status = status;
		this.patchByteLength = patchByteLength;
	}
}

/** Header values are untrusted: accept only a finite non-negative integer. */
function parsePatchByteLength(headers: Headers): number | null {
	const raw = headers.get(PATCH_BYTE_LENGTH_HEADER);
	if (raw === null || !/^\d+$/u.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

export type PatchLoadState = "fetching" | "streaming" | "ready" | "error";

export interface UsePatchLoaderOptions {
	collapseMode: "expanded" | "collapsed";
	/** Absolute workspace directory the diff is generated for. */
	workspaceDirectory: string;
	/** Requests the patch without the size cap (the user's "Show anyway"). */
	unlimited: boolean;
	viewerRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
}

export interface UsePatchLoaderResult {
	applyCollapseModeToLoaded: (mode: "expanded" | "collapsed") => void;
	diffStats: GitDiffStats | null;
	/** HTTP status of the failed request, or null for non-HTTP failures. */
	errorStatus: number | null;
	errorMessage: string | null;
	/** Byte length of the oversized patch behind a 413, when the server reported it. */
	errorPatchByteLength: number | null;
	expandItem: (itemId: string) => void;
	initialItems: CodeViewItem<undefined>[];
	loadState: PatchLoadState;
	/**
	 * Coalesced in-place reload: one task in flight, at most one follow-up
	 * queued, latest wins. Settles when the load it joined does; never rejects.
	 */
	refresh: () => Promise<void>;
	/**
	 * Message of the latest in-place refresh that failed transiently while
	 * the last result stayed on screen; null once a load succeeds.
	 */
	refreshError: string | null;
	/** True while an in-place refresh streams; first loads report through loadState instead. */
	refreshing: boolean;
	toggleItemCollapsed: (itemId: string) => void;
	treeSource: GitDiffTreeSource | null;
	/**
	 * Directory `treeSource` was built from. Lags `workspaceDirectory` for a
	 * commit after it changes (the reset runs in an effect), so consumers that
	 * act on a specific folder's paths must check it.
	 */
	treeSourceDirectory: string | null;
	viewerKey: number;
}

/**
 * Fetches `kilo-git://diff/patch?cwd=…` and streams the patch into the
 * CodeView imperatively (`initialItems` + `addItems`), the tree, and the
 * stats.
 *
 * `unlimited` appends `&unlimited=1`. Like the directory it is an effect
 * dep, so flipping it is a fresh first load, and every later refresh
 * keeps sending it.
 *
 * The first load per directory resets and streams progressively (remounting
 * the viewer via `viewerKey`); every later load of the same directory is an
 * in-place refresh — VS Code git's model: the current diff stays on screen
 * while the new patch streams into a fresh accumulator, then commits once.
 * The commit reuses the live item object for unchanged files (same stored
 * raw patch key), so collapse state, versions and expanded hunks survive;
 * changed files re-open with a bumped version (CodeView only replaces a
 * record whose `version` changed); new files follow the collapse mode.
 *
 * Scheduling is VS Code's `@throttle` half: a per-effect `Throttler` keeps
 * at most one load in flight and collapses any requests that arrive
 * meanwhile into exactly one follow-up (latest wins). The effect owns the
 * throttler — its cleanup disposes it, which aborts the in-flight load and
 * drops the queued one, so folder switches and unmounts are race-free. The
 * follow-up runs after either success or failure because `load` never
 * rejects: it catches into one of the failure states below itself (a
 * rejected queued task would leave its callers unsettled).
 *
 * Failures follow VS Code's SCM: keep the last state and keep going. An
 * in-place refresh that fails transiently (5xx, or no HTTP status at all)
 * while a result is on screen (`ready`, a diff or "No changes") only sets
 * `refreshError`; the content stays and the next success clears it. Any
 * other failure — 400/403/404/413, or anything while nothing is on screen
 * (first load, error state) — takes the error state and clears the items,
 * tree and stats so the sidebar never lists files next to an error panel.
 * Which statuses pause auto-refresh is the view's call, not this hook's.
 *
 * Raw patch keys are kept in `livePatchKeysRef` — recorded before the
 * viewer ever sees an item — because hunk expansion rewrites the live
 * `fileDiff.cacheKey` in place to `…:hydrated`; change detection must
 * compare stored raw keys, never the live item's mutated key. The same keys
 * let an in-place refresh reuse the live parse of every byte-identical file
 * instead of calling `processFile` again.
 *
 * Raw `fetch` + `AbortSignal` is deliberate, not an oversight: the response
 * body is consumed progressively as files stream in, which `useSdkQuery`'s
 * resolve-once model cannot express. The signal also keeps the effect safe
 * under StrictMode double-invoke and tab remounts.
 *
 * Adapted from diffshub's `usePatchLoader` (no GitHub token, no line-hash
 * deep links). Transient values (requestId, live patch keys, collapse mode,
 * the refresh queue) live in refs by design so the long-lived streaming
 * closure reads live state without re-binding. The supersession guards on
 * `appendStreamedFile` are not upstream — do not drop on re-sync (diffshub
 * has the same race).
 */
export function usePatchLoader({
	collapseMode,
	workspaceDirectory,
	unlimited,
	viewerRef,
}: UsePatchLoaderOptions): UsePatchLoaderResult {
	const [initialItems, setInitialItems] = useState<CodeViewItem<undefined>[]>([]);
	const [treeSource, setTreeSource] = useState<GitDiffTreeSource | null>(null);
	const [treeSourceDirectory, setTreeSourceDirectory] = useState<string | null>(null);
	const [diffStats, setDiffStats] = useState<GitDiffStats | null>(null);
	const [loadState, setLoadState] = useState<PatchLoadState>("fetching");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [errorStatus, setErrorStatus] = useState<number | null>(null);
	const [errorPatchByteLength, setErrorPatchByteLength] = useState<number | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const [viewerKey, setViewerKey] = useState(0);
	const loadStateRef = useLatest(loadState);
	const requestIdRef = useRef(0);
	// Raw cache keys (pre-hydration) by live item id, so bulk collapse
	// updates can walk the full set (the handle exposes no enumeration API)
	// and refresh commits can tell changed from unchanged files.
	const livePatchKeysRef = useRef<Map<string, string | undefined>>(new Map());
	// Mirrors the live collapse mode so the streaming closure reads it
	// without us re-binding the effect on every change.
	const collapseModeRef = useLatest(collapseMode);
	// The current directory's throttler's queue function; set by the load
	// effect and read by the stable `refresh` callback.
	const queueRefreshRef = useRef<(() => Promise<void>) | undefined>(undefined);

	// Pre-mutates fresh items so they arrive in the viewer matching the
	// current collapse mode, then records their raw patch keys for later
	// bulk updates and refresh commits. Deleted-file diffs initialize
	// collapsed by default, so the overwrite is unconditional — otherwise
	// they would stay collapsed even in expanded mode.
	const prepareItemsForViewer = (items: readonly CodeViewItem<undefined>[]): void => {
		const targetCollapsed = collapseModeRef.current === "collapsed";
		for (const item of items) {
			livePatchKeysRef.current.set(item.id, rawPatchKey(item));
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

		for (const itemId of livePatchKeysRef.current.keys()) {
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
		// Per effect run: dispose aborts the in-flight load and drops the
		// queued one, so folder switches and unmounts never leak a load.
		const throttler = new Throttler();

		const load = async (signal: AbortSignal, inPlace: boolean): Promise<void> => {
			const requestId = ++requestIdRef.current;
			const isCurrentRequest = () => requestIdRef.current === requestId && !signal.aborted;

			try {
				if (inPlace) {
					// In-place refresh: nothing resets — the current diff, empty
					// state or error panel stays on screen until the commit.
					setRefreshing(true);
				} else {
					// First load or folder switch: full reset. Also clears a
					// stale `refreshing` left by an in-place refresh this
					// folder switch just aborted.
					livePatchKeysRef.current = new Map();
					setRefreshing(false);
					setViewerKey(requestId);
					setInitialItems([]);
					setTreeSource(null);
					setTreeSourceDirectory(null);
					setDiffStats(null);
					setErrorMessage(null);
					setErrorStatus(null);
					setErrorPatchByteLength(null);
					setRefreshError(null);
					setLoadState("fetching");
				}

				// Deliberately a raw fetch — see the hook doc comment.
				const response = await fetch(
					`kilo-git://diff/patch?cwd=${encodeURIComponent(workspaceDirectory)}${unlimited ? "&unlimited=1" : ""}`,
					{
						cache: "no-store",
						signal,
					},
				);

				if (!response.ok) {
					const detail = (await response.text()).trim();
					throw new PatchRequestError(
						response.status,
						detail.length > 0 ? detail : `Request failed (${response.status}).`,
						parsePatchByteLength(response.headers),
					);
				}

				if (response.body == null) {
					throw new Error(GENERIC_PATCH_LOAD_ERROR_MESSAGE);
				}

				if (!inPlace) {
					setLoadState("streaming");
					await yieldToBrowser();
					if (!isCurrentRequest()) {
						return;
					}
				}

				const accumulator = createGitDiffDataAccumulator();
				const reusableDiffs = inPlace
					? collectLiveDiffsByRawKey(livePatchKeysRef.current, viewerRef.current)
					: new Map<string, LiveFileDiff>();
				// A reused diff may already carry the `…:hydrated` key, so its
				// raw key is recorded here instead of read back from it.
				const reusedRawKeys = new WeakMap<LiveFileDiff, string>();
				const rawKeyOf = (item: CodeViewItem<undefined>) =>
					(item.type === "diff" ? reusedRawKeys.get(item.fileDiff) : undefined) ??
					rawPatchKey(item);
				let pendingPublishFileCount = 0;
				let pendingTreePublishFileCount = 0;
				let hasPublishedTree = false;
				let hasPublishedInitialItems = false;
				let lastPublishTime = performance.now();
				let lastWorkYieldTime = lastPublishTime;
				let lastTreePublishTime = lastPublishTime;

				const publishTreeSource = () => {
					// In-place refreshes publish the tree once at the commit,
					// not progressively — the current tree stays on screen.
					if (inPlace || pendingTreePublishFileCount === 0 || !isCurrentRequest()) {
						return;
					}

					pendingTreePublishFileCount = 0;
					hasPublishedTree = true;
					lastTreePublishTime = performance.now();
					setDiffStats({ ...accumulator.diffStats });
					setTreeSource(snapshotGitDiffTreeSource(accumulator));
					setTreeSourceDirectory(workspaceDirectory);
				};

				const publishPendingData = async () => {
					if (pendingPublishFileCount === 0 || !isCurrentRequest()) {
						return;
					}

					pendingPublishFileCount = 0;
					lastPublishTime = performance.now();
					if (inPlace) {
						// The commit at the end of the stream is atomic, so the
						// fresh items stay pending — same-path renames then
						// re-key them inside the accumulator instead of
						// renaming items on the live viewer. Yield on the
						// work budget so parsing keeps the UI responsive.
						await yieldToBrowser();
						lastWorkYieldTime = performance.now();
						return;
					}
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
					// viewer and the NEW live key map. Not upstream — do not
					// drop on a diffshub re-sync.
					if (!isCurrentRequest()) {
						return;
					}
					const cacheKey = createPatchFileCacheKey(fileText);
					const reusedDiff = reusableDiffs.get(cacheKey);
					if (reusedDiff !== undefined) {
						reusableDiffs.delete(cacheKey);
						reusedRawKeys.set(reusedDiff, cacheKey);
					}
					const fileDiff = reusedDiff ?? processFile(fileText, { cacheKey, isGitDiff: true });
					if (fileDiff == null) {
						return;
					}

					const itemIdRename = appendFileDiffToGitDiffData(accumulator, fileDiff);
					if (itemIdRename != null) {
						viewerRef.current?.updateItemId(itemIdRename.oldId, itemIdRename.newId);
						const rawKey = livePatchKeysRef.current.get(itemIdRename.oldId);
						if (rawKey !== undefined) {
							livePatchKeysRef.current.delete(itemIdRename.oldId);
							livePatchKeysRef.current.set(itemIdRename.newId, rawKey);
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

				if (fallbackPatchContent != null && fallbackPatchContent.trim().length > 0) {
					throw new Error(GENERIC_PATCH_LOAD_ERROR_MESSAGE);
				}

				if (inPlace) {
					// Atomic commit: the viewer reconciles in place (scroll-
					// anchored), unchanged files keep their live item objects,
					// and setInitialItems mirrors the list so the panel shows
					// the empty state for zero items and mounts a fresh viewer
					// when coming from empty or error. Zero files also
					// publish no tree, like a first load that streamed
					// nothing, so the sidebar shows its placeholder.
					const viewer = viewerRef.current;
					const items = mergeWithLiveItems(
						accumulator.items,
						livePatchKeysRef.current,
						viewer,
						collapseModeRef.current,
						rawKeyOf,
					);
					livePatchKeysRef.current = new Map(
						accumulator.items.map((item) => [item.id, rawKeyOf(item)] as const),
					);
					viewer?.getInstance()?.setItems(items);
					setInitialItems(items);
					if (accumulator.items.length > 0) {
						setTreeSource(snapshotGitDiffTreeSource(accumulator));
						setTreeSourceDirectory(workspaceDirectory);
					} else {
						setTreeSource(null);
						setTreeSourceDirectory(null);
					}
				} else {
					await publishPendingData();
					publishTreeSource();
				}

				setErrorMessage(null);
				setErrorStatus(null);
				setErrorPatchByteLength(null);
				setRefreshError(null);
				setDiffStats({ ...accumulator.diffStats });
				setLoadState("ready");
			} catch (error) {
				if (!isCurrentRequest()) {
					return;
				}
				const message = getPatchLoadErrorMessage(error);
				const status = error instanceof PatchRequestError ? error.status : null;
				if (inPlace && loadStateRef.current === "ready" && isTransientFailure(status)) {
					setRefreshError(message);
					return;
				}
				setRefreshError(null);
				setErrorMessage(message);
				setErrorStatus(status);
				setErrorPatchByteLength(error instanceof PatchRequestError ? error.patchByteLength : null);
				setLoadState("error");
				// Clear the leftover content so the sidebar never lists files
				// next to an error panel.
				setInitialItems([]);
				setTreeSource(null);
				setTreeSourceDirectory(null);
				setDiffStats(null);
			} finally {
				// An aborted load (folder switch, unmount) must not clobber
				// the flags of the load that superseded it.
				if (isCurrentRequest()) {
					setRefreshing(false);
				}
			}
		};

		queueRefreshRef.current = () => throttler.queue((signal) => load(signal, true));
		void throttler.queue((signal) => load(signal, false));

		return () => {
			throttler.dispose();
		};
	}, [unlimited, viewerRef, workspaceDirectory]);

	// A disposed throttler (folder switch, unmount) rejects the queue call;
	// the superseding load owns the view by then, so there is nothing to do.
	const refresh = useStableCallback(async (): Promise<void> =>
		queueRefreshRef.current?.().catch(() => undefined),
	);

	return {
		applyCollapseModeToLoaded,
		diffStats,
		errorStatus,
		errorMessage,
		errorPatchByteLength,
		expandItem,
		initialItems,
		loadState,
		refresh,
		refreshError,
		refreshing,
		toggleItemCollapsed,
		treeSource,
		treeSourceDirectory,
		viewerKey,
	};
}

/**
 * Applies the refresh-commit rules to the freshly accumulated items: an
 * unchanged file (same stored raw patch key) reuses its live item object so
 * collapse state, version and expanded hunks survive the commit; a changed
 * file re-opens with a bumped version (CodeView only replaces a record
 * whose `version` changed); a new file follows the collapse mode. Removed
 * files simply drop out of the list — `setItems` reconciles by id.
 */
function mergeWithLiveItems(
	nextItems: readonly CodeViewItem<undefined>[],
	livePatchKeys: ReadonlyMap<string, string | undefined>,
	viewer: CodeViewHandle<undefined, undefined> | null,
	collapseMode: "expanded" | "collapsed",
	rawKeyOf: (item: CodeViewItem<undefined>) => string | undefined,
): CodeViewItem<undefined>[] {
	const targetCollapsed = collapseMode === "collapsed";
	// No live viewer (empty state or error panel): every file is new.
	if (viewer?.getInstance() == null) {
		return nextItems.map((item) =>
			item.type === "diff" ? { ...item, collapsed: targetCollapsed } : item,
		);
	}

	return nextItems.map((item) => {
		// Patch streams only produce diff items; this guard narrows the
		// CodeViewItem union for the compiler, nothing more.
		if (item.type !== "diff") {
			return item;
		}
		const liveItem = viewer.getItem(item.id);
		if (liveItem == null) {
			// New file: follows the collapse mode.
			return { ...item, collapsed: targetCollapsed };
		}
		if (rawKeyOf(item) === livePatchKeys.get(item.id)) {
			// Unchanged file: reuse the live item object so collapse state,
			// version and expanded hunks survive the commit.
			return liveItem;
		}
		// Changed file: re-open with a bumped version so CodeView replaces
		// the record (an equal version would keep the old snapshot).
		return { ...item, collapsed: false, version: getNextItemVersion(liveItem) };
	});
}

type LiveFileDiff = Extract<CodeViewItem<undefined>, { type: "diff" }>["fileDiff"];

/**
 * The live viewer's parsed diffs by stored raw patch key, so an in-place
 * refresh can skip `processFile` for byte-identical files. Safe to hand to
 * the accumulator: the commit returns the live item for those files
 * anyway, and the accumulator reads only `name`, `type` and the per-hunk
 * line counts, all of which hydration keeps. Empty without a viewer.
 */
function collectLiveDiffsByRawKey(
	livePatchKeys: ReadonlyMap<string, string | undefined>,
	viewer: CodeViewHandle<undefined, undefined> | null,
): Map<string, LiveFileDiff> {
	const diffs = new Map<string, LiveFileDiff>();
	if (viewer == null) {
		return diffs;
	}
	for (const [itemId, rawKey] of livePatchKeys) {
		const item = viewer.getItem(itemId);
		if (rawKey !== undefined && item?.type === "diff") {
			diffs.set(rawKey, item.fileDiff);
		}
	}
	return diffs;
}

/**
 * The raw patch key of a streamed item, captured before the viewer ever
 * renders it — hunk expansion later rewrites `fileDiff.cacheKey` in place
 * to `…:hydrated`, so change detection must compare stored raw keys,
 * never the live item's mutated key.
 */
function rawPatchKey(item: CodeViewItem<undefined>): string | undefined {
	return item.type === "diff" ? item.fileDiff.cacheKey : undefined;
}

/**
 * A failure worth riding out with the last result on screen: git failing,
 * git missing, or no HTTP status at all (network, stream, non-patch body).
 * Request-shape refusals, "not a repository" and "too large" are not.
 */
function isTransientFailure(status: number | null): boolean {
	return status === null || status >= 500;
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
