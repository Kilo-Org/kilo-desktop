import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { FileDiffIcon, FolderGitIcon, GitCompareIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "react-use";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useExtensions } from "@kilo-desktop/kernel/web";
import {
	FileObjectType,
	Opener,
	Panes,
	workSessionFolders,
	Workspaces,
	type PaneProps,
	type WorkSessionFolder,
} from "@kilo-desktop/plugin-work-sessions/contracts";
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

import { CHANGES_PANE_METADATA, Repository } from "../../contracts";
import { repositoryTypeQuery, useInitRepository } from "../shared/repository-queries";
import { CollapseDiffButton, collapseButtonForHeaderClick } from "./CollapseDiffButton";
import { DiffConfigProvider, useDiffOptions } from "./diff-options";
import { useDiffTheme } from "./diff-theme";
import {
	FileHeaderActions,
	FileHeaderActionsContext,
	type FileHeaderActionsValue,
} from "./FileHeaderActions";
import { GitDiffHeader } from "./GitDiffHeader";
import { GitDiffSidebar } from "./GitDiffSidebar";
import { createDiffFilesLoader } from "./lib/diff-files-loader";
import { fileOpenTarget } from "./lib/file-open-target";
import { useCopyText } from "./use-copy-text";
import { useGitDiffWatcher } from "./use-git-diff-watcher";
import { usePaneVisibility } from "./use-pane-visibility";
import { usePatchLoader } from "./use-patch-loader";
import { DiffWorkerPool } from "./worker-pool";

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
	/* File actions after the name: shown on header hover or keyboard focus,
	   faded (not display:none) so they stay in the tab order. */
	slot[name="header-filename-suffix"]::slotted(*) {
		opacity: 0;
		transition: opacity 120ms;
	}
	[data-diffs-header]:hover slot[name="header-filename-suffix"]::slotted(*),
	slot[name="header-filename-suffix"]::slotted(:focus-within) {
		opacity: 1;
	}
`;

const NOT_A_REPOSITORY_STATUS = 404;
const PATCH_TOO_LARGE_STATUS = 413;

const BYTES_PER_MIB = 1024 * 1024;

/** MiB with one decimal, matching git-client's own too-large message. */
function tooLargeTitle(patchByteLength: number | null): string {
	const title = "The diff is too large to show by default";
	return patchByteLength === null
		? title
		: `${title} (${(patchByteLength / BYTES_PER_MIB).toFixed(1)} MiB)`;
}

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
 * vs HEAD) of the work session's folder as a streaming CodeView with a file-tree
 * sidebar, refreshed in place from kilo.work-sessions' file changes. The folder
 * picker offers the work session's folders (its worktree standing in for the
 * primary); pane metadata from `changes_open` picks a folder and a file to
 * reveal, once per request.
 */
export function ChangesPane({ workSessionId, workspaceId, directory, pane }: PaneProps) {
	const workspaceFolders = useDomainObjectState(
		Workspaces,
		(state: DomainObjectState<typeof Workspaces>) =>
			state.workspaces.find((workspace) => workspace.id === workspaceId)?.folders,
	);
	const folders = workSessionFolders(
		(workspaceFolders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
		directory,
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
					workSessionId={workSessionId}
					workspaceDirectory={workspaceDirectory}
					folders={folders}
				/>
			</DiffConfigProvider>
		</DiffWorkerPool>
	);
}

// Module-level so its identity never changes: it is CodeView's per-item slot
// memo key, so every input that changes reaches the headers through
// FileHeaderActionsContext instead.
function renderHeaderFilenameSuffix(item: CodeViewItem<undefined>) {
	return item.type === "diff" ? <FileHeaderActions fileDiff={item.fileDiff} /> : null;
}

/**
 * Copy path and Open file for the file headers. Open goes through
 * kilo.work-sessions' openers (kilo.files, kilo.notebook…), so it shows only
 * when one opens workspace files. The gate is per type: a pattern-limited
 * opener (kilo.notebook's `*.ipynb`) can still offer Open on a file it
 * doesn't match, and the click then reports that no pane opens it.
 */
function useFileHeaderActions(
	workSessionId: string,
	directory: string,
	folders: readonly WorkSessionFolder[],
): FileHeaderActionsValue {
	const repository = useDomainObject(Repository);
	const panes = useDomainObject(Panes);
	const canOpenFiles = useExtensions(Opener).some(
		(opener) => opener.metadata.match.type === FileObjectType.id,
	);
	const { data: repositoryType } = useQuery(repositoryTypeQuery(repository, directory));
	const topLevel =
		repositoryType?.kind === "regular" ? repositoryType.topLevelWorkingDirectory : null;
	const writeText = useCopyText();
	const openTarget = (repositoryPath: string) =>
		panes && canOpenFiles && topLevel !== null
			? fileOpenTarget(repositoryPath, topLevel, folders)
			: null;
	const open = async (path: string) => {
		if (!panes) throw new Error("Files can't be opened here.");
		const pane = await panes.methods.openObject({
			workSessionId,
			ref: { type: FileObjectType.id, id: path },
		});
		if (pane === null) throw new Error("No pane here opens this kind of file.");
		return pane;
	};
	return { writeText, openTarget, open };
}

function GitDiffTabContent({
	metadata,
	workSessionId,
	workspaceDirectory,
	folders,
}: {
	readonly metadata: Readonly<Record<string, string>>;
	readonly workSessionId: string;
	readonly workspaceDirectory: string;
	readonly folders: readonly WorkSessionFolder[];
}) {
	const repository = useDomainObject(Repository);
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
	// The choice wins only while it is still one of the work session's folders.
	const effectiveDirectory = folders.some((folder) => folder.path === chosenDirectory)
		? chosenDirectory
		: workspaceDirectory;
	// "Show anyway" is ongoing request config (later refreshes must keep
	// sending it), scoped to the folder it was granted for: any change of
	// effective directory revokes it, so switching back is capped again.
	const [unlimitedDirectory, setUnlimitedDirectory] = useState<string | null>(null);
	if (unlimitedDirectory !== null && unlimitedDirectory !== effectiveDirectory) {
		setUnlimitedDirectory(null);
	}
	const unlimited = unlimitedDirectory === effectiveDirectory;
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
	} = usePatchLoader({
		collapseMode,
		workspaceDirectory: effectiveDirectory,
		unlimited,
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

	const loadDiffFiles = createDiffFilesLoader(
		(input) =>
			repository?.methods.getDiffContents(input) ??
			Promise.reject(new Error("Git isn't available.")),
		effectiveDirectory,
	);

	const options = {
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
	};

	// `applyCollapseModeToLoaded` is a side effect, so it must not run inside
	// a setState updater (StrictMode double-invokes updaters and they are
	// expected to be pure); compute `next` from state and apply it after.
	const toggleCollapseMode = () => {
		const next = collapseMode === "expanded" ? "collapsed" : "expanded";
		setCollapseMode(next);
		applyCollapseModeToLoaded(next);
	};

	const renderHeaderPrefix = (item: CodeViewItem<undefined>) =>
		item.type === "diff" ? (
			<CollapseDiffButton
				collapsed={item.collapsed === true}
				disabled={item.fileDiff.splitLineCount === 0 && item.fileDiff.unifiedLineCount === 0}
				onToggle={() => toggleItemCollapsed(item.id)}
			/>
		) : null;

	const headerActions = useFileHeaderActions(workSessionId, effectiveDirectory, folders);

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
	const handleFilesResize = (delta: number) => {
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
	};

	const toggleTreeCollapsed = () => {
		setTreeCollapsed(!treeCollapsed);
	};

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
	const retryButton = (
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
			{errorStatus === PATCH_TOO_LARGE_STATUS ? "Reload" : "Try again"}
		</Button>
	);

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
												? tooLargeTitle(errorPatchByteLength)
												: "The diff could not be loaded"}
									</EmptyTitle>
									{errorStatus === PATCH_TOO_LARGE_STATUS ? null : (
										<EmptyDescription>
											{errorStatus === NOT_A_REPOSITORY_STATUS
												? "This folder isn't a git repository. Initialize git to track its changes, or choose a different workspace folder."
												: errorMessage}
										</EmptyDescription>
									)}
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
									) : errorStatus === PATCH_TOO_LARGE_STATUS ? (
										<div className="flex gap-2">
											{/* No pending spinner: the uncapped load swaps this panel for the loading state. */}
											<Button
												data-qa-id="git-diff-show-anyway"
												disabled={refreshing}
												onClick={() => setUnlimitedDirectory(effectiveDirectory)}
												size="sm"
											>
												<FileDiffIcon data-icon="inline-start" aria-hidden="true" />
												Show anyway
											</Button>
											{retryButton}
										</div>
									) : (
										retryButton
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
								<FileHeaderActionsContext value={headerActions}>
									<CodeView
										key={viewerKey}
										ref={viewerRef}
										className="h-full overflow-y-auto [&_diffs-container]:shadow-[0_-1px_0_var(--border),0_1px_0_var(--border)]"
										initialItems={initialItems}
										options={options}
										renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
										renderHeaderPrefix={renderHeaderPrefix}
									/>
								</FileHeaderActionsContext>
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
