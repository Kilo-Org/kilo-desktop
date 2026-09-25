import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FolderGit2Icon, GitCompareIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocalStorage } from "react-use";

import { useSdk } from "@kilo-desktop/sdk-react";
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

import type { GitServiceContract } from "../contracts/schemas.js";
import { CollapseDiffButton } from "./CollapseDiffButton.js";
import { DiffConfigProvider, useDiffOptions } from "./diff-options.js";
import { GitDiffHeader } from "./GitDiffHeader.js";
import { GitDiffSidebar } from "./GitDiffSidebar.js";
import { createDiffFilesLoader } from "./lib/diff-files-loader.js";
import { useGitDiffWatcher } from "./use-git-diff-watcher.js";
import { useInitRepository } from "./use-init-repository.js";
import { usePaneVisibility } from "./use-pane-visibility.js";
import { usePatchLoader } from "./use-patch-loader.js";

export interface GitDiffViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
	readonly workspaceDirectory?: string | undefined;
	readonly workspaceFolders?: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
	readonly metadata?: Readonly<Record<string, string>>;
}

// 1px gap lets adjacent containers' hairline separators overlap into a
// single line between files (diffshub-style); the hairlines themselves are
// drawn by the diffs-container box-shadow on the CodeView below. No top
// padding: the toolbar's border-b is the list's top edge, and the first
// container's top hairline is clipped by the scrollport.
const DIFF_VIEW_LAYOUT = { paddingTop: 0, gap: 1, paddingBottom: 8 } as const;
// The default CodeView metrics assume the package's own default font metrics
// (lineHeight: 20px, diffHeaderHeight: 44px). We override --diffs-line-height
// to 1.125rem (18px at 16px root) and --diffs-gap-fallback is unchanged at
// 8px, so the rendered header min-height is 1lh + (8px × 3) = 18 + 24 = 42px.
// Passing the corrected metrics keeps the virtualizer's size estimates in sync
// with the actual rendered dimensions, eliminating the gap at the top of the
// diff list caused by the stickyOffset div being sized against stale metrics.
const DIFF_VIEW_ITEM_METRICS = { lineHeight: 18, diffHeaderHeight: 42 } as const;
const DIFF_VIEW_UNSAFE_CSS = `
	:host {
		--diffs-bg: var(--pane-surface, var(--background));
		--diffs-font-size: 0.75rem;
		--diffs-line-height: 1.125rem;
		background-color: var(--pane-surface, var(--background));
	}
`;

const NOT_A_REPOSITORY_STATUS = 404;
const PATCH_TOO_LARGE_STATUS = 413;

const DEFAULT_FILES_WIDTH = 224;
const MIN_FILES_WIDTH = 160;
const FILES_WIDTH_STORAGE_KEY = "git.diffFilesWidth";

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
 * "Changes" chat right-panel tab: renders this chat's workspace working-tree
 * diff (staged + unstaged + untracked vs HEAD) as a streaming CodeView with a
 * file-tree sidebar. Live: workspace file events refresh the diff in place.
 */
export function GitDiffView(props: GitDiffViewProps) {
	if (!props.workspaceDirectory) {
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
							Open a workspace chat to review its uncommitted changes.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	// NOTE: intentionally no `WorkerPoolContextProvider` here — this view
	// depends on the ambient pierre worker pool from kilo-ui's
	// `PierreDiffProvider` (app-lifetime via `contributes.providers`). Do
	// not add our own: a nested provider spawns a duplicate pool (extra
	// workers + separate AST LRU). If kilo-ui's provider is ever absent,
	// CodeView falls back to main-thread highlighting — functional, just
	// slower.
	return (
		<DiffConfigProvider>
			<GitDiffTabContent
				workspaceDirectory={props.workspaceDirectory}
				workspaceFolders={props.workspaceFolders}
			/>
		</DiffConfigProvider>
	);
}

function GitDiffTabContent({
	workspaceDirectory,
	workspaceFolders,
}: {
	readonly workspaceDirectory: string;
	readonly workspaceFolders: GitDiffViewProps["workspaceFolders"];
}) {
	const sdk = useSdk<GitServiceContract>("git");
	// Normalized folder list: the host may pass none (undefined or empty), in
	// which case the single workspace directory stands in as the only folder.
	// Memoized so the sidebar's folderOptions memo is not invalidated on
	// every unrelated re-render (e.g. each search keystroke).
	const folders = useMemo(
		() =>
			workspaceFolders?.length ? workspaceFolders : [{ path: workspaceDirectory, isPrimary: true }],
		[workspaceFolders, workspaceDirectory],
	);
	// The user's folder choice is session-only state and must live here
	// (above the panel group) because the loader re-fetches automatically
	// when the effective directory (in its effect deps) changes.
	const [chosenDirectory, setChosenDirectory] = useState(workspaceDirectory);
	// The user's choice wins only while it is still one of the workspace's
	// folders; once it leaves the list the effective directory falls back
	// to the workspace directory prop, and the loader re-fetches.
	const effectiveDirectory = folders.some((folder) => folder.path === chosenDirectory)
		? chosenDirectory
		: workspaceDirectory;
	const viewerRef = useRef<CodeViewHandle<undefined, undefined> | null>(null);
	const groupRef = useRef<HTMLDivElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [collapseMode, setCollapseMode] = useState<"expanded" | "collapsed">("expanded");
	// Tree collapse is session-only state that must live here because the
	// header (outside the panel group) renders the toggle.
	const [treeCollapsed, setTreeCollapsed] = useState(false);
	// Destructured per field so the CodeView `options` memo below keeps its
	// fine-grained primitive deps — a whole `opts` dep would churn the options
	// revision across every virtualized item on any future added field.
	const { diffIndicators, diffStyle, showBackgrounds, showLineNumbers, wrapLines } =
		useDiffOptions()[0];
	const appearance = useSyncExternalStore(sdk.theme.subscribe, sdk.theme.appearance);
	const { mode: themeType, shiki } = appearance;
	// File-tree width persistence: read once at mount, write on user resize.
	// Multiple Changes tabs may be mounted at once and react-use does not
	// sync same-tab instances; each tab reads at mount and its writes blindly
	// win — the same read-once/blind-write behavior this used when the
	// helpers were manual. Full-value writes only, so the stale-closure
	// caveat from diff-options.tsx does not apply here.
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
		() => createDiffFilesLoader(sdk.client, effectiveDirectory),
		[sdk, effectiveDirectory],
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
		[filesWidth, setStoredFilesWidth, treeCollapsed],
	);

	const toggleTreeCollapsed = useCallback(() => {
		setTreeCollapsed((collapsed) => !collapsed);
	}, []);

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
					: "Couldn't load changes."
			: loading
				? "Loading changes…"
				: loadState === "ready" && fileCount === 0
					? "No changed files."
					: null;

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" data-qa-id="git-diff-root" ref={rootRef}>
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
			<ResizablePanelGroup className="min-h-0 min-w-0 flex-1" ref={groupRef}>
				<ResizablePanel className="min-h-0 min-w-0">
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
											? `${errorMessage} Live reload is paused. Retry once the changes are smaller.`
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
											<Spinner data-icon="inline-start" size="sm" />
										) : (
											<FolderGit2Icon data-icon="inline-start" />
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
											<Spinner data-icon="inline-start" size="sm" />
										) : (
											<RefreshCwIcon />
										)}
										Retry
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
									<LoaderCircleIcon
										aria-hidden="true"
										className="text-muted-foreground size-5 animate-spin"
									/>
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
					the divider and pin a persistent, pixel-aligned 1px hairline
					to the sidebar's left edge.
				*/}
					<ResizableHandle
						ariaLabel="Resize file tree"
						className="before:bg-border -right-1 before:w-px before:translate-x-0"
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
						source={treeSource}
						treePlaceholder={treePlaceholder}
						viewerRef={viewerRef}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
