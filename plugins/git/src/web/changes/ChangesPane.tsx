import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FolderGitIcon, GitCompareIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "react-use";

import type { DomainState } from "@kilo-desktop/kernel";
import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import type { PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@kilo-desktop/ui/components/resizable";

import {
	CHANGES_PANE_METADATA,
	Repository,
	sessionFolders,
	type SessionFolder,
} from "../../contracts/index.js";
import { useInitRepository } from "../repository-queries.js";
import { CollapseDiffButton, collapseButtonForHeaderClick } from "./CollapseDiffButton.js";
import { DiffConfigProvider, useDiffOptions } from "./diff-options.js";
import { useDiffTheme } from "./diff-theme.js";
import { GitDiffHeader } from "./GitDiffHeader.js";
import { GitDiffSidebar } from "./GitDiffSidebar.js";
import { createDiffFilesLoader } from "./lib/diff-files-loader.js";
import { useGitDiffWatcher } from "./use-git-diff-watcher.js";
import { usePaneVisibility } from "./use-pane-visibility.js";
import { usePatchLoader } from "./use-patch-loader.js";
import { DiffWorkerPool } from "./worker-pool.js";

export { GitCompareIcon as ChangesIcon } from "lucide-react";

// 1px gap lets adjacent containers' hairline separators overlap into a
// single line between files (diffshub-style); the hairlines themselves are
// drawn by the diffs-container box-shadow on the CodeView below. No top
// padding: the first container's top hairline is clipped by the scrollport,
// so the toolbar flows into the first file without a rule of its own.
const DIFF_VIEW_LAYOUT = { paddingTop: 0, gap: 1, paddingBottom: 8 } as const;
// The default CodeView metrics assume the package's own default font metrics
// (lineHeight: 20px, diffHeaderHeight: 44px). We override --diffs-line-height
// to 1rem (16px at 16px root) and --diffs-gap-fallback is unchanged at
// 8px, so the rendered header min-height is 1lh + (8px × 3) = 16 + 24 = 40px.
// Passing the corrected metrics keeps the virtualizer's size estimates in sync
// with the actual rendered dimensions, eliminating the gap at the top of the
// diff list caused by the stickyOffset div being sized against stale metrics.
const DIFF_VIEW_ITEM_METRICS = { lineHeight: 16, diffHeaderHeight: 40 } as const;
const DIFF_VIEW_UNSAFE_CSS = `
	:host {
		--diffs-bg: var(--pane-surface, var(--background));
		--diffs-font-size: 0.6875rem;
		--diffs-line-height: 1rem;
		background-color: var(--pane-surface, var(--background));
	}
	[data-diffs-header] {
		cursor: pointer;
	}
`;

const NOT_A_REPOSITORY_STATUS = 404;
const PATCH_TOO_LARGE_STATUS = 413;

const DEFAULT_FILES_WIDTH = 224;
const MIN_FILES_WIDTH = 160;
const FILES_WIDTH_STORAGE_KEY = "git.diffFilesWidth";
const TREE_COLLAPSED_STORAGE_KEY = "git.diffTreeCollapsed:v1";

/**
 * Storage is untrusted: accept only a finite positive number, anything else
 * falls back to the default width. Returning undefined tells react-use to
 * fall back to the initial value.
 */
function deserializeFilesWidth(raw: string): number | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

/**
 * The Changes pane: the uncommitted changes (staged, unstaged and untracked
 * vs HEAD) of the session's folder as a streaming CodeView with a file-tree
 * sidebar, refreshed in place from kilo.workspaces' file changes. The folder
 * picker offers the session's folders (its worktree standing in for the
 * primary); pane metadata from `changes_open` picks a folder and a file to
 * reveal, once per request.
 */
export function ChangesPane({ workspaceId, directory, pane }: PaneProps) {
	const workspaceFolders = useDomainState(
		Workspaces,
		useCallback(
			(state: DomainState<typeof Workspaces>) =>
				state.workspaces.find((workspace) => workspace.id === workspaceId)?.folders,
			[workspaceId],
		),
	);
	const folders = useMemo(
		() =>
			sessionFolders(
				(workspaceFolders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
				directory,
			),
		[workspaceFolders, directory],
	);
	const workspaceDirectory = folders.find((folder) => folder.isPrimary)?.path ?? folders[0]?.path;

	if (!workspaceId || !workspaceDirectory) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center" data-qa-id="git-diff-root">
				<Empty data-qa-id="git-diff-no-workspace">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<GitCompareIcon />
						</EmptyMedia>
						<EmptyTitle aria-level={2} role="heading">
							No workspace
						</EmptyTitle>
						<EmptyDescription>
							Open a workspace session to review its uncommitted changes.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	return (
		<DiffWorkerPool>
			<DiffConfigProvider>
				<GitDiffTabContent
					metadata={pane.metadata}
					workspaceDirectory={workspaceDirectory}
					folders={folders}
				/>
			</DiffConfigProvider>
		</DiffWorkerPool>
	);
}

function GitDiffTabContent({
	metadata,
	workspaceDirectory,
	folders,
}: {
	readonly metadata: Readonly<Record<string, string>>;
	readonly workspaceDirectory: string;
	readonly folders: readonly SessionFolder[];
}) {
	const repository = useDomain(Repository);
	// The person's folder choice is pane-local state above the panel group:
	// the loader re-fetches when the effective directory changes. Each new
	// reveal request re-applies its folder once; later picks still win.
	const requestedDirectory = metadata[CHANGES_PANE_METADATA.workspaceDirectory];
	const revealRequest = metadata[CHANGES_PANE_METADATA.revealRequest];
	const revealPath = metadata[CHANGES_PANE_METADATA.revealPath];
	const requestedFolder = folders.some((folder) => folder.path === requestedDirectory)
		? requestedDirectory
		: undefined;
	const [chosenDirectory, setChosenDirectory] = useState(requestedFolder ?? workspaceDirectory);
	const [appliedRevealRequest, setAppliedRevealRequest] = useState(revealRequest);
	if (revealRequest !== appliedRevealRequest) {
		setAppliedRevealRequest(revealRequest);
		if (requestedFolder) setChosenDirectory(requestedFolder);
	}
	// The choice wins only while it is still one of the session's folders.
	const effectiveDirectory = folders.some((folder) => folder.path === chosenDirectory)
		? chosenDirectory
		: workspaceDirectory;
	const viewerRef = useRef<CodeViewHandle<undefined, undefined> | null>(null);
	const groupRef = useRef<HTMLDivElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [collapseMode, setCollapseMode] = useState<"expanded" | "collapsed">("expanded");
	// Tree collapse must live here because the header (outside the panel
	// group) renders the toggle. Strict `=== true` so a non-boolean stored
	// value falls back to open.
	const [storedTreeCollapsed, setTreeCollapsed] = useLocalStorage(
		TREE_COLLAPSED_STORAGE_KEY,
		false,
	);
	const treeCollapsed = storedTreeCollapsed === true;
	// Destructured per field so the CodeView `options` memo below keeps its
	// fine-grained primitive deps — a whole `opts` dep would churn the options
	// revision across every virtualized item on any future added field.
	const { diffIndicators, diffStyle, showBackgrounds, showLineNumbers, wrapLines } =
		useDiffOptions()[0];
	const appearance = useDiffTheme();
	const { mode: themeType, shiki } = appearance;
	// File-tree width and collapse persistence: read once at mount, write on
	// user action. Multiple Changes tabs may be mounted at once and react-use
	// does not sync same-tab instances; each tab reads at mount and its
	// writes blindly win. Full-value writes only — react-use's functional
	// setter form reads stale state (see diff-options.tsx).
	const [storedFilesWidth, setStoredFilesWidth] = useLocalStorage<number | undefined>(
		FILES_WIDTH_STORAGE_KEY,
		undefined,
		{
			raw: false,
			serializer: (width) => JSON.stringify(width),
			deserializer: deserializeFilesWidth,
		},
	);
	const filesWidth = storedFilesWidth ?? DEFAULT_FILES_WIDTH;

	const {
		applyCollapseModeToLoaded,
		diffStats,
		errorStatus,
		errorMessage,
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
	} = usePatchLoader({
		collapseMode,
		workspaceDirectory: effectiveDirectory,
		viewerRef,
	});
	// Only a too-large diff pauses auto-refresh, VS Code's `isRepositoryHuge`
	// analog: every refresh would regenerate the same oversized patch. Other
	// failures keep watching, so a 404 recovers after `git init` in a
	// terminal and a transient failure recovers on the next change.
	useGitDiffWatcher({
		directory: effectiveDirectory,
		refresh,
		paused: errorStatus === PATCH_TOO_LARGE_STATUS,
		visibility: usePaneVisibility(rootRef),
	});
	const initRepository = useInitRepository();

	// Load-bearing memo, not cosmetics: a fresh loadDiffFiles identity per
	// render would make `options` new every render and churn CodeView's
	// options revision across every virtualized item.
	const loadDiffFiles = useMemo(
		() =>
			createDiffFilesLoader(
				(input) =>
					repository?.methods.getDiffContents(input) ??
					Promise.reject(new Error("Git isn't available.")),
				effectiveDirectory,
			),
		[repository, effectiveDirectory],
	);

	const options = useMemo(
		() => ({
			theme: shiki,
			themeType,
			diffIndicators,
			diffStyle,
			disableBackground: !showBackgrounds,
			disableLineNumbers: !showLineNumbers,
			stickyHeaders: true,
			overflow: (wrapLines ? "wrap" : "scroll") as "wrap" | "scroll",
			layout: DIFF_VIEW_LAYOUT,
			itemMetrics: DIFF_VIEW_ITEM_METRICS,
			unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
			loadDiffFiles,
		}),
		[
			diffIndicators,
			diffStyle,
			loadDiffFiles,
			showBackgrounds,
			showLineNumbers,
			themeType,
			wrapLines,
			shiki,
		],
	);

	// `applyCollapseModeToLoaded` is a side effect, so it must not run inside
	// a setState updater (StrictMode double-invokes updaters and they are
	// expected to be pure); compute `next` from state and apply it after.
	const toggleCollapseMode = useCallback(() => {
		const next = collapseMode === "expanded" ? "collapsed" : "expanded";
		setCollapseMode(next);
		applyCollapseModeToLoaded(next);
	}, [collapseMode, applyCollapseModeToLoaded]);

	// toggleItemCollapsed is useStableCallback-stable, so this stays identity-
	// stable too and unrelated renders (theme, diff style, panel state) never
	// re-render CodeView item children.
	const renderHeaderPrefix = useCallback(
		(item: CodeViewItem<undefined>) =>
			item.type === "diff" ? (
				<CollapseDiffButton
					collapsed={item.collapsed === true}
					disabled={item.fileDiff.splitLineCount === 0 && item.fileDiff.unifiedLineCount === 0}
					onToggle={() => toggleItemCollapsed(item.id)}
				/>
			) : null,
		[toggleItemCollapsed],
	);

	// Native listener: the headers render inside CodeView's shadow roots, so
	// only the composed path can tell a header click from a body click.
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const onClick = (event: MouseEvent) => collapseButtonForHeaderClick(event)?.click();
		root.addEventListener("click", onClick);
		return () => root.removeEventListener("click", onClick);
	}, []);

	// The handle reports pointer travel since drag start and keeps the
	// pointerdown-time onResize closure alive for the whole drag, so the
	// width below is the drag-start width and every move recomputes the
	// full target width — the same delta-from-start pattern ChatPaneCanvas
	// uses for column resizes. Keyboard presses go through React's latest
	// closure, so they resize from the current width.
	const handleFilesResize = useCallback(
		(delta: number) => {
			// The tree sits right of the divider, so positive travel (divider
			// pushed right) shrinks it and negative travel grows it. When
			// collapsed the edge handle is the panel's only visible affordance:
			// growing from it reopens the panel, shrinking keeps it collapsed.
			if (treeCollapsed) {
				if (delta >= 0) return;
				setTreeCollapsed(false);
			}
			const group = groupRef.current;
			const maxWidth =
				group && group.clientWidth > 0 ? group.clientWidth / 2 : Number.POSITIVE_INFINITY;
			setStoredFilesWidth(
				Math.min(maxWidth, Math.max(MIN_FILES_WIDTH, (treeCollapsed ? 0 : filesWidth) - delta)),
			);
		},
		[filesWidth, setStoredFilesWidth, setTreeCollapsed, treeCollapsed],
	);

	const toggleTreeCollapsed = useCallback(() => {
		setTreeCollapsed(!treeCollapsed);
	}, [setTreeCollapsed, treeCollapsed]);

	const loading = loadState === "fetching" || loadState === "streaming";
	// First-load `loading` and in-place `refreshing` share one busy flag for
	// the header spinner and the sidebar refresh button; the placeholder
	// text below keeps first-load `loading` so the empty and error states
	// do not flash during a refresh.
	const busy = loading || refreshing;
	const fileCount = diffStats?.fileCount ?? 0;
	// Sidebar one-liner for the states that have no tree to show. Only
	// rendered while no tree snapshot exists (source == null); a partial
	// tree always wins over the loading/error line.
	const treePlaceholder =
		loadState === "error"
			? errorStatus === NOT_A_REPOSITORY_STATUS
				? "Not a git repository."
				: errorStatus === PATCH_TOO_LARGE_STATUS
					? "Diff too large."
					: "Could not load changes."
			: loading
				? "Loading changes…"
				: loadState === "ready" && fileCount === 0
					? "No changed files."
					: null;

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" data-qa-id="git-diff-root" ref={rootRef}>
			{/*
				Each column owns its toolbar on one shared row (diff actions here,
				search and refresh atop the tree), so the split runs unbroken from
				the tab divider to the bottom.
			*/}
			<ResizablePanelGroup className="min-h-0 min-w-0 flex-1" ref={groupRef}>
				<ResizablePanel className="flex min-h-0 min-w-0 flex-col">
					<GitDiffHeader
						addedLines={diffStats?.addedLines ?? 0}
						collapseMode={collapseMode}
						deletedLines={diffStats?.deletedLines ?? 0}
						fileCount={fileCount}
						loading={busy}
						onToggleCollapseMode={toggleCollapseMode}
						onToggleTreeCollapsed={toggleTreeCollapsed}
						refreshError={refreshError}
						treeCollapsed={treeCollapsed}
					/>
					<div className="min-h-0 min-w-0 flex-1">
						{loadState === "error" ? (
							// h-full: ResizablePanel is a block container, so
							// Empty's flex-1 is inert here and the block would
							// pin to the top without it.
							<Empty className="h-full" data-qa-id="git-diff-error">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<GitCompareIcon />
									</EmptyMedia>
									<EmptyTitle aria-level={2} role="heading">
										{errorStatus === NOT_A_REPOSITORY_STATUS
											? "Not a git repository"
											: errorStatus === PATCH_TOO_LARGE_STATUS
												? "The diff is too large to show"
												: "The diff could not be loaded"}
									</EmptyTitle>
									<EmptyDescription>
										{errorStatus === NOT_A_REPOSITORY_STATUS
											? "This folder isn't a git repository. Initialize git to track its changes, or choose a different workspace folder."
											: errorStatus === PATCH_TOO_LARGE_STATUS
												? `${errorMessage} Live reload is paused. Try again once the changes are smaller.`
												: errorMessage}
									</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									{errorStatus === NOT_A_REPOSITORY_STATUS ? (
										<Button
											data-qa-id="git-diff-init"
											disabled={initRepository.isPending || refreshing}
											onClick={() => initRepository.init(effectiveDirectory, refresh)}
											size="sm"
											variant="outline"
										>
											{initRepository.isPending || refreshing ? (
												<Spinner data-icon="inline-start" aria-hidden="true" />
											) : (
												<FolderGitIcon data-icon="inline-start" />
											)}
											Initialize Git
										</Button>
									) : (
										<Button
											data-qa-id="git-diff-retry"
											disabled={refreshing}
											onClick={refresh}
											size="sm"
											variant="outline"
										>
											{refreshing ? (
												<Spinner data-icon="inline-start" aria-hidden="true" />
											) : (
												<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
											)}
											Try again
										</Button>
									)}
								</EmptyContent>
							</Empty>
						) : initialItems.length > 0 ? (
							/*
								Imperative CodeView ownership: initialItems seeds ONLY at
								mount (later prop changes are ignored), so the viewer must
								mount after the loader's first publish, and remount (key)
								only on a folder switch. In-place refreshes reconcile
								through setItems; initialItems mirrors the current list so
								the panel branches follow (0 items shows the empty state).
							*/
							<div className="h-full min-h-0 min-w-0" data-qa-id="git-diff-view">
								<CodeView
									key={viewerKey}
									ref={viewerRef}
									className="h-full overflow-y-auto [&_diffs-container]:shadow-[0_-1px_0_var(--border),0_1px_0_var(--border)]"
									initialItems={initialItems}
									options={options}
									renderHeaderPrefix={renderHeaderPrefix}
								/>
							</div>
						) : loadState === "ready" && fileCount === 0 ? (
							<Empty className="h-full" data-qa-id="git-diff-empty">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<GitCompareIcon />
									</EmptyMedia>
									<EmptyTitle aria-level={2} role="heading">
										No changes
									</EmptyTitle>
									<EmptyDescription>The working directory matches HEAD.</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : loading ? (
							// h-full: ResizablePanel is a block container, so Empty's
							// flex-1 is inert here (same as the error branch above).
							<Empty
								aria-busy="true"
								aria-live="polite"
								className="h-full"
								data-qa-id="git-diff-viewer-loading"
								role="status"
							>
								<EmptyHeader>
									<EmptyMedia>
										<Spinner aria-hidden="true" className="text-muted-foreground size-5" />
									</EmptyMedia>
									<EmptyTitle aria-level={2} role="heading">
										{loadState === "streaming" ? "Streaming changes" : "Fetching changes"}
									</EmptyTitle>
									<EmptyDescription>
										{loadState === "streaming"
											? "Showing files as they arrive…"
											: "Reading the working tree…"}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : null}
					</div>
				</ResizablePanel>
				{/*
				Zero-width handle anchor: ResizableHandle is absolutely
				positioned against its parent's right edge, so the spacer's
				right edge must sit exactly on the divider — anchored inside
				either panel the handle would be clipped by its overflow-hidden.
			*/}
				<div className="relative w-0 shrink-0">
					{/*
					The shared handle is centered on a 4px column gutter (chat
					canvas); Changes has no gutter, so re-center the hit area on
					the divider and pin a persistent pane hairline (the island's
					edge weight) to the sidebar's left edge.
				*/}
					<ResizableHandle
						ariaLabel="Resize file tree"
						className="-right-1 before:w-[0.5px] before:translate-x-0 before:bg-(color:--pane-hairline)"
						onResize={handleFilesResize}
						qaId="git-diff-tree-resize"
					/>
				</div>
				<ResizablePanel
					className="min-h-0"
					data-qa-id="git-diff-files-panel"
					width={treeCollapsed ? 0 : filesWidth}
				>
					<GitDiffSidebar
						appearance={appearance}
						loading={busy}
						workspaceDirectory={effectiveDirectory}
						workspaceFolders={folders}
						onExpandItem={expandItem}
						onSelectWorkspaceFolder={setChosenDirectory}
						onRefresh={refresh}
						{...(revealPath && revealRequest && treeSourceDirectory === effectiveDirectory
							? { revealPath, revealRequest }
							: {})}
						source={treeSource}
						treePlaceholder={treePlaceholder}
						viewerRef={viewerRef}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
