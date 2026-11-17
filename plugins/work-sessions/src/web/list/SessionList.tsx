import { ContextMenu } from "@base-ui/react/context-menu";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArchiveIcon,
	ChevronDownIcon,
	EllipsisIcon,
	FolderIcon,
	FolderOpenIcon,
	MessageSquareIcon,
	PencilIcon,
	PinIcon,
	PlusIcon,
	SearchIcon,
	Trash2Icon,
} from "lucide-react";
import {
	createContext,
	use,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type FC,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
	type RefObject,
} from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useDomainObject,
	useDomainObjectState,
	dragSourceProps,
	useExtensions,
} from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { Kbd } from "@kilo-desktop/ui/components/kbd";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@kilo-desktop/ui/components/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@kilo-desktop/ui/components/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
import {
	useWorkspacePickerSource,
	workspaceGlyphColor,
} from "@kilo-desktop/ui/components/workspace-picker";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	UNSCOPED_WORKSPACE_FOCUS,
	WorkSessionDecoration,
	WorkSessionListAction,
	WorkSessionObjectType,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type Workspace,
	type WorkSession,
	type WorkSessionsWindowState,
} from "../../contracts";
import { lastVisitedOf, useLastVisits, type LastVisited } from "../attention/last-visited";
import { useSessionActivities } from "../attention/live-activity";
import { startNewWorkSession } from "../home/new-session";
import { directoryBasename } from "../shared/directory";
import {
	useWorkSessionSearchOpen,
	visibleWorkSessions,
	workSessionSearch,
} from "../shared/list-state";
import { ShortcutHintChip } from "../shared/ShortcutHintChip";
import { useShortcutHints } from "../shared/shortcut-hints";
import { resolveWorkspaceFocus } from "../shared/workspace-focus";
import { WorkspaceSourceProvider } from "../shared/workspace-source";
import {
	activityOfSession,
	deriveSessionRowState,
	resolveSessionLocationLabel,
	sessionRowCapabilities,
	type SessionActivity,
} from "./session-activity";
import {
	buildSessionListSections,
	readSessionListArchivedExpanded,
	SESSION_LIST_STATUS_LABELS,
	visibleShowFields,
	workspaceIdForFocus,
	writeSessionListArchivedExpanded,
	type SessionListSection,
	type SessionListSectionRow,
	type SessionListShowField,
	type SessionListView,
} from "./session-list-view";
import { SessionBulkDeleteDialog, SessionBulkMenuItems } from "./session-bulk-actions";
import {
	EMPTY_SESSION_LIST_SELECTION,
	extendSessionListSelection,
	selectSessionListRange,
} from "./session-list-selection";
import { SessionListViewMenu } from "./session-list-view-menu";
import {
	MoreActionsTrigger,
	SessionRenameInput,
	SessionRowMenu,
	SessionRowMenuItems,
	useRenameState,
} from "./session-row-actions";
import { useSessionActions } from "./session-renderers";
import { SessionRelativeTime, SessionRowGlyph } from "./session-row-display";
import { usePrefetchWorkSession } from "./use-prefetch-work-session";
import { SessionRowHoverCard } from "./session-row-hover-card";
import { usePullRequestFacet } from "./use-pull-request-facet";
import { useSessionListView } from "./use-session-list-view";
import { WorkspaceFilter } from "./WorkspaceFilter";

/*
 * The session list (kilo.shell/left-sidebar): the New session and Search
 * entries, the workspace filter and view menu, then sessions grouped into
 * shelves — pinned, by status, workspace or day, and archived last. Rows are
 * virtualised; work sessions come from `work-sessions`, the window's focus and open
 * work session from `window`.
 */

/**
 * Shared surface states for session rows, on the app's state scale: idle is
 * clear, hover and focus take the hover wash, and the current row the selected
 * wash (the same fill as an unfocused pane's shown tab).
 */
const sidebarSurfaceIdleClassName =
	"bg-transparent text-sidebar-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent";
const sidebarSurfaceActiveClassName = "bg-state-selected text-sidebar-foreground";
/** One step above the current row, so a ⌘/⇧-click selection reads apart from it. */
const sidebarSurfaceMultiSelectedClassName = "bg-state-selected-strong text-sidebar-foreground";

/** Override Button/Input `rounded-lg` so radius matches sidebar menu items. */
const sidebarNavRadiusClassName = "rounded-md!";

/**
 * Hover actions sit over the status slot: hidden until row hover, keyboard
 * focus, or an open dropdown, then swap with the status label (which hides
 * via the matching group classes on the label itself).
 */
const rowHoverActionsClassName =
	"pointer-events-none absolute flex items-center opacity-0 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

const rowHoverLabelFadeClassName =
	"group-hover/sidebar-row:opacity-0 group-has-[:focus-visible]/sidebar-row:opacity-0 group-has-[[data-popup-open]]/sidebar-row:opacity-0";

const narrowRowYieldsTimeClassName = "@max-[14rem]/session-row:peer-[:not(:empty)]/pr:hidden";

const workspaceHeaderActionsClassName =
	"pointer-events-none mr-1 flex shrink-0 items-center gap-0.5 opacity-0 group-hover/workspace-row:pointer-events-auto group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:pointer-events-auto group-focus-within/workspace-row:opacity-100 group-has-[[data-popup-open]]/workspace-row:pointer-events-auto group-has-[[data-popup-open]]/workspace-row:opacity-100";

const SESSION_LIST_OVERSCAN = 10;
const SESSION_ROW_ESTIMATE_PX = 30;
const SESSION_SHELF_HEADER_PX = 30;
const SESSION_SECTION_GAP_PX = 5;
const DEFAULT_EXPANDED_SECTIONS: Readonly<Record<string, boolean>> = { archived: false };
const NO_SESSIONS: readonly WorkSession[] = [];
const NO_WORKSPACES: readonly Workspace[] = [];
const EMPTY_NAVIGATOR: WorkSessionsWindowState = {
	focus: null,
	activeWorkSessionId: null,
	view: null,
	detachedViews: [],
};

const selectWorkSessions = (state: { workSessions: readonly WorkSession[] }) => state.workSessions;
const selectWorkspaces = (state: { workspaces: readonly Workspace[] }) => state.workspaces;
const selectNavigator = (state: WorkSessionsWindowState) => state;

type SessionsHandle = DomainObjectHandle<typeof WorkSessions>;

interface SessionListChrome {
	readonly show: readonly SessionListShowField[];
	readonly activeWorkSessionId: string | null;
	readonly workspaces: readonly Workspace[];
	readonly sessions: SessionsHandle | null;
	readonly open: (sessionId: string) => void;
	/** The pointer came to rest on a session's row: load it ahead (`usePrefetchWorkSession`). */
	readonly intendToOpen: (sessionId: string) => void;
	readonly cancelIntentToOpen: () => void;
	readonly activities: Readonly<Record<string, SessionActivity>>;
	readonly visits: LastVisited;
	/** Session id → number chip while the go-to-session modifier is held. */
	readonly shortcutHints: ReadonlyMap<string, string>;
	/** ⌘/⇧-click multi-selection, by session id. */
	readonly selectedIds: ReadonlySet<string>;
	readonly selectRow: (id: string, range: boolean) => void;
	readonly clearSelection: () => void;
	/** Opens the delete confirm for the selection. */
	readonly deleteSelection: () => void;
}

const SessionListChromeContext = createContext<SessionListChrome>({
	show: [],
	activeWorkSessionId: null,
	workspaces: [],
	sessions: null,
	open: () => undefined,
	intendToOpen: () => undefined,
	cancelIntentToOpen: () => undefined,
	activities: {},
	visits: { sessions: {}, originChats: {} },
	shortcutHints: new Map(),
	selectedIds: new Set(),
	selectRow: () => undefined,
	clearSelection: () => undefined,
	deleteSelection: () => undefined,
});

type VirtualSessionListEntry =
	| {
			kind: "header";
			key: string;
			sectionKey: string;
			tone: SessionListSection["tone"];
			label: string;
			workspaceId: string | undefined;
			expanded: boolean;
			spaceBefore: boolean;
	  }
	| {
			kind: "row";
			key: string;
			row: SessionListSectionRow;
			indented: boolean;
			spaceBefore: boolean;
	  }
	| {
			kind: "empty-workspace";
			key: string;
			workspaceId: string;
			label: string;
			spaceBefore: boolean;
	  };

/** Why a filtered list is empty, or null when no filter is active. */
function filteredEmptyLabel(view: Pick<SessionListView, "status" | "pullRequest">): string | null {
	const byStatus = view.status !== "all";
	const byPullRequest = view.pullRequest !== "all";
	if (byStatus && byPullRequest) return "No matching sessions";
	if (byStatus) return `No sessions matching "${SESSION_LIST_STATUS_LABELS[view.status]}"`;
	if (view.pullRequest === "open") return "No sessions with open pull requests";
	if (byPullRequest) return "No sessions with pull requests";
	return null;
}

/** The note under an empty workspace group. */
function emptyWorkspaceLabel(view: Pick<SessionListView, "status" | "pullRequest">): string {
	return filteredEmptyLabel(view) ?? "No sessions yet";
}

/** Why the whole list is empty, or null when there is nothing to explain. */
function sessionListEmptyLabel(
	view: Pick<SessionListView, "focus" | "status" | "pullRequest">,
	workspaces: readonly { id: string; name: string }[],
): string | null {
	if (view.focus === UNSCOPED_WORKSPACE_FOCUS) return "No sessions outside a workspace";
	const focusedWorkspace = workspaces.find((workspace) => workspace.id === view.focus);
	if (focusedWorkspace) return `No sessions in ${focusedWorkspace.name}`;
	return filteredEmptyLabel(view);
}

/**
 * The Archived filter opens the Archived shelf, since it holds every match.
 * Leaving the filter restores the persisted preference, which the filter
 * itself never overwrites.
 */
function archivedShelfExpandedFor(status: SessionListView["status"]): boolean {
	return status === "archived" || readSessionListArchivedExpanded();
}

function flattenSessionListSections(
	sections: readonly SessionListSection[],
	expanded: Readonly<Record<string, boolean>>,
	options: { spaceBeforeFirst: boolean; emptyWorkspaceLabel: string },
): VirtualSessionListEntry[] {
	const entries: VirtualSessionListEntry[] = [];
	let firstEntry = true;
	let hasHeader = false;

	for (const section of sections) {
		const isExpanded = !section.label || expanded[section.key] !== false;
		if (section.label) {
			entries.push({
				kind: "header",
				key: `header:${section.key}`,
				sectionKey: section.key,
				tone: section.tone,
				label: section.label,
				workspaceId: section.workspaceId,
				expanded: isExpanded,
				spaceBefore: (firstEntry && options.spaceBeforeFirst) || hasHeader,
			});
			firstEntry = false;
			hasHeader = true;
		}

		if (!isExpanded) continue;
		if (section.workspaceId && section.rows.length === 0) {
			entries.push({
				kind: "empty-workspace",
				key: `empty:${section.key}`,
				workspaceId: section.workspaceId,
				label: options.emptyWorkspaceLabel,
				spaceBefore: false,
			});
		}
		for (const row of section.rows) {
			entries.push({
				kind: "row",
				key: `row:${row.id}`,
				row,
				indented: Boolean(section.label),
				spaceBefore: firstEntry && options.spaceBeforeFirst,
			});
			firstEntry = false;
		}
	}

	return entries;
}

interface SessionListShape {
	readonly sections: readonly SessionListSection[];
	readonly pinnedSections: readonly SessionListSection[];
	readonly groupedSections: readonly SessionListSection[];
	/** Keys of the shelves with a header, which can be collapsed. */
	readonly collapsibleKeys: readonly string[];
}

/** The list's shelves for the view, split into the pinned shelf and the rest. */
function shapeSessionList(input: {
	readonly sessions: readonly WorkSession[];
	readonly activities: Readonly<Record<string, SessionActivity>>;
	readonly workspaces: readonly Workspace[];
	readonly view: SessionListView;
	readonly pullRequests: ReturnType<typeof usePullRequestFacet>;
}): SessionListShape {
	const { sessions } = input;
	const sections = buildSessionListSections({
		entries: sessions.map((session, sourceIndex) => ({
			id: session.id,
			sessionId: session.id,
			remoteId: session.id,
			title: session.title,
			sourceIndex,
			archived: session.archived,
		})),
		activityBySessionId: input.activities,
		workspaces: input.workspaces,
		view: input.view,
		pinnedIds: new Set(sessions.filter((session) => session.pinned).map((session) => session.id)),
		pullRequestBySessionId: input.pullRequests,
	});
	return {
		sections,
		pinnedSections: sections.filter((section) => section.tone === "pinned"),
		groupedSections: sections.filter((section) => section.tone !== "pinned"),
		collapsibleKeys: sections.flatMap((section) => (section.label ? [section.key] : [])),
	};
}

/** The sessions' live activities and the list's shelves for `view`. */
function useSessionListShape(
	sessions: readonly WorkSession[],
	workspaces: readonly Workspace[],
	view: SessionListView,
	pullRequests: ReturnType<typeof usePullRequestFacet>,
) {
	const activities = useSessionActivities(sessions);
	const shape = shapeSessionList({ sessions, activities, workspaces, view, pullRequests });
	return { activities, shape };
}

/** The virtualised entries for the expanded shelves, with the session rows' ids in list order. */
function flattenSessionList(
	shape: SessionListShape,
	expanded: Readonly<Record<string, boolean>>,
	view: SessionListView,
): {
	readonly entries: readonly VirtualSessionListEntry[];
	readonly rowOrder: readonly string[];
	/** Rows that are not archived: the ones go-to-session shortcuts number. */
	readonly visibleSessionIds: readonly string[];
} {
	const label = emptyWorkspaceLabel(view);
	const entries = [
		...flattenSessionListSections(shape.pinnedSections, expanded, {
			spaceBeforeFirst: false,
			emptyWorkspaceLabel: label,
		}),
		...flattenSessionListSections(shape.groupedSections, expanded, {
			spaceBeforeFirst: shape.pinnedSections.length > 0,
			emptyWorkspaceLabel: label,
		}),
	];
	return {
		entries,
		rowOrder: entries.flatMap((entry) => (entry.kind === "row" ? [entry.row.id] : [])),
		visibleSessionIds: entries.flatMap((entry) =>
			entry.kind === "row" && !entry.row.archived ? [entry.row.id] : [],
		),
	};
}

/** The selected ids still in `rowOrder`, in list order. */
function selectedRowIds(
	rowOrder: readonly string[],
	selection: { readonly ids: ReadonlySet<string> },
): ReadonlySet<string> {
	return new Set(rowOrder.filter((id) => selection.ids.has(id)));
}

/**
 * The list's rows for the expanded shelves; publishes the visible sessions
 * (`visibleWorkSessions`) and returns their go-to-session shortcut hints.
 */
function useSessionListRows(
	shape: SessionListShape,
	expanded: Readonly<Record<string, boolean>>,
	view: SessionListView,
) {
	const { entries, rowOrder, visibleSessionIds } = flattenSessionList(shape, expanded, view);
	useEffect(() => visibleWorkSessions.set(visibleSessionIds), [visibleSessionIds]);
	const shortcutHints = useShortcutHints("work-session", visibleSessionIds);
	return { entries, rowOrder, shortcutHints };
}

/** kilo.work-sessions' contribution to kilo.shell/left-sidebar. */
export function SessionList() {
	return (
		<WorkspaceSourceProvider>
			<SessionListContent />
		</WorkspaceSourceProvider>
	);
}

function SessionListContent() {
	const { view: storedView, update, reset } = useSessionListView();
	const sessionsHandle = useDomainObject(WorkSessions);
	const sessions = useDomainObjectState(WorkSessions, selectWorkSessions) ?? NO_SESSIONS;
	const workspaceSource = useWorkspacePickerSource();
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	const navigatorHandle = useDomainObject(WorkSessionsWindow);
	const navigator = useDomainObjectState(WorkSessionsWindow, selectNavigator) ?? EMPTY_NAVIGATOR;

	const view = { ...storedView, focus: navigator.focus };
	const setFocus = (focus: string | null) => {
		void navigatorHandle?.methods.setFocus({ focus });
		workspaceSource.setActiveWorkspaceId(workspaceIdForFocus(focus));
	};
	const updateView = (patch: Partial<SessionListView>) => {
		const { focus, ...rest } = patch;
		if (focus !== undefined) setFocus(focus);
		if (Object.keys(rest).length > 0) update(rest);
	};
	const open = (workSessionId: string) =>
		void navigatorHandle?.methods.openWorkSession({ workSessionId });
	const prefetch = usePrefetchWorkSession();

	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
		...DEFAULT_EXPANDED_SECTIONS,
		archived: archivedShelfExpandedFor(view.status),
	}));
	const [statusFilter, setStatusFilter] = useState(view.status);
	if (statusFilter !== view.status) {
		setStatusFilter(view.status);
		setExpanded((current) => ({ ...current, archived: archivedShelfExpandedFor(view.status) }));
	}
	const focus = resolveWorkspaceFocus(view.focus, workspaces);
	const pullRequests = usePullRequestFacet();
	const pullRequestFilterAvailable = pullRequests !== null;
	const pullRequest = pullRequestFilterAvailable ? view.pullRequest : "all";
	const resolvedView =
		focus === view.focus && pullRequest === view.pullRequest
			? view
			: { ...view, focus, pullRequest };
	const show = visibleShowFields(resolvedView);
	const { activities, shape } = useSessionListShape(
		sessions,
		workspaces,
		resolvedView,
		pullRequests,
	);
	const visits = useLastVisits();
	const listRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<SessionListViewportHandle>(null);
	const [selection, setSelection] = useState(EMPTY_SESSION_LIST_SELECTION);
	const [deleting, setDeleting] = useState<readonly WorkSession[] | null>(null);
	// Scroll back to the top whenever the list shows a different scope.
	const listScope = JSON.stringify([
		resolvedView.focus,
		resolvedView.grouping,
		resolvedView.ordering,
		resolvedView.status,
		resolvedView.pullRequest,
	]);
	const scrolledScopeRef = useRef<string | null>(null);
	useEffect(() => {
		if (scrolledScopeRef.current === listScope) return;
		scrolledScopeRef.current = listScope;
		listRef.current?.scrollTo({ top: 0 });
	}, [listScope]);

	const { sections, collapsibleKeys } = shape;
	const {
		entries: virtualEntries,
		rowOrder,
		shortcutHints,
	} = useSessionListRows(shape, expanded, resolvedView);
	const allCollapsed =
		collapsibleKeys.length > 0 && collapsibleKeys.every((key) => expanded[key] === false);
	const emptyLabel = sessionListEmptyLabel(resolvedView, workspaces);
	const newSessionInWorkspace = (workspaceId: string) => {
		workspaceSource.setActiveWorkspaceId(workspaceId);
		void navigatorHandle?.methods.closeWorkSession(undefined);
	};

	const sessionsById = new Map(sessions.map((session) => [session.id, session]));

	// Rows that leave the list (deleted, filtered, collapsed) drop out of the selection.
	const selectedIds = selectedRowIds(rowOrder, selection);
	const openId = navigator.view ? null : navigator.activeWorkSessionId;
	const selectRow = (id: string, range: boolean) =>
		setSelection((current) =>
			extendSessionListSelection(current, { id, range, order: rowOrder, openId }),
		);
	const clearSelection = () => setSelection(EMPTY_SESSION_LIST_SELECTION);
	const focusRow = (id: string) => {
		const focus = () => {
			const trigger = listRef.current?.querySelector<HTMLElement>(
				`[data-session-id="${CSS.escape(id)}"] [data-qa-id="session-list-item-trigger"]`,
			);
			trigger?.focus();
			return trigger;
		};
		viewportRef.current?.scrollToIndex(
			virtualEntries.findIndex((entry) => entry.key === `row:${id}`),
		);
		// A row scrolled in from outside the window mounts on the next frame.
		if (!focus()) requestAnimationFrame(focus);
	};
	/** ↑/↓ move between sessions, ⇧↑/⇧↓ select a range, ⌘A/Ctrl+A selects every visible one. */
	const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target instanceof HTMLInputElement) return;
		const id = (event.target as HTMLElement).closest<HTMLElement>("[data-session-id]")?.dataset
			.sessionId;
		if (!id) return;
		if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			setSelection({ ids: new Set(rowOrder), anchor: id });
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const next = rowOrder[rowOrder.indexOf(id) + (event.key === "ArrowDown" ? 1 : -1)];
		if (!next) return;
		event.preventDefault();
		if (event.shiftKey) {
			setSelection((current) =>
				selectSessionListRange(current, { from: id, to: next, order: rowOrder }),
			);
		}
		focusRow(next);
	};
	const onListClick = (event: MouseEvent<HTMLDivElement>) => {
		if (!(event.target as Element).closest("[data-session-id], button, input")) clearSelection();
	};
	const deleteSelection = () => {
		setDeleting([...selectedIds].flatMap((id) => sessionsById.get(id) ?? []));
		clearSelection();
	};
	const hasSelection = selectedIds.size > 0;
	useEffect(() => {
		if (!hasSelection) return;
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") clearSelection();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [clearSelection, hasSelection]);
	const chrome: SessionListChrome = {
		show,
		// A session behind a sessions view is not the one shown.
		activeWorkSessionId: navigator.view ? null : navigator.activeWorkSessionId,
		workspaces,
		sessions: sessionsHandle,
		open,
		intendToOpen: prefetch.intend,
		cancelIntentToOpen: prefetch.cancel,
		activities,
		visits,
		shortcutHints,
		selectedIds,
		selectRow,
		clearSelection,
		deleteSelection,
	};

	return (
		<div data-qa-id="kilo-thread-list" className="flex min-h-0 flex-1 flex-col">
			<SessionListChromeContext value={chrome}>
				<section
					className="mb-3 flex shrink-0 flex-col gap-0.5 pt-0.5"
					aria-label="Session actions"
					data-qa-id="session-list-navigation"
				>
					<SidebarMenu className="gap-0.5">
						<SidebarMenuItem>
							<NewSessionButton />
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SessionListSearch
								sessions={sessions}
								workspaces={workspaces}
								onSelectSession={open}
								onSelectWorkspace={(id) => updateView({ focus: id })}
							/>
						</SidebarMenuItem>
					</SidebarMenu>
				</section>
				<section aria-label="Sessions" className="flex min-h-0 min-w-0 flex-1 flex-col">
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
						<div
							data-qa-id="session-list-grouping-header"
							className="hover:bg-sidebar-accent focus-within:bg-sidebar-accent has-[[data-popup-open]]:bg-sidebar-accent flex h-[30px] min-w-0 shrink-0 items-center gap-0.5 rounded-md pr-1"
						>
							<WorkspaceFilter
								value={focus}
								unscopedValue={UNSCOPED_WORKSPACE_FOCUS}
								onValueChange={(nextFocus) => updateView({ focus: nextFocus })}
							/>
							<SessionListViewMenu
								view={resolvedView}
								pullRequestFilterAvailable={pullRequestFilterAvailable}
								onViewChange={updateView}
								onReset={() => {
									reset();
									setFocus(null);
								}}
								canCollapse={collapsibleKeys.length > 0}
								allCollapsed={allCollapsed}
								onCollapseAll={() => {
									if (collapsibleKeys.includes("archived")) writeSessionListArchivedExpanded(false);
									setExpanded((current) => ({
										...current,
										...Object.fromEntries(collapsibleKeys.map((key) => [key, false])),
									}));
								}}
								onExpandAll={() => {
									if (collapsibleKeys.includes("archived")) writeSessionListArchivedExpanded(true);
									setExpanded((current) => ({
										...current,
										...Object.fromEntries(collapsibleKeys.map((key) => [key, true])),
									}));
								}}
							/>
							<NavigatorActions />
						</div>
						<SessionListViewport
							handleRef={viewportRef}
							listRef={listRef}
							entries={virtualEntries}
							renderEntry={(entry) =>
								entry.kind === "header" ? (
									<SessionShelfHeader
										tone={entry.tone}
										label={entry.label}
										workspace={workspaces.find((workspace) => workspace.id === entry.workspaceId)}
										onNewSessionInWorkspace={newSessionInWorkspace}
										expanded={entry.expanded}
										onToggle={() => {
											const nextExpanded = !entry.expanded;
											if (entry.sectionKey === "archived") {
												writeSessionListArchivedExpanded(nextExpanded);
											}
											setExpanded((current) => ({
												...current,
												[entry.sectionKey]: nextExpanded,
											}));
										}}
									/>
								) : entry.kind === "empty-workspace" ? (
									<WorkspaceEmptyRow workspaceId={entry.workspaceId} label={entry.label} />
								) : (
									<SessionRowSlot
										session={sessionsById.get(entry.row.id)}
										indented={entry.indented}
									/>
								)
							}
							onKeyDown={onListKeyDown}
							onClick={onListClick}
						>
							{emptyLabel && sections.length === 0 ? (
								<div
									data-qa-id="session-list-empty"
									className="text-muted-foreground px-2.5 py-4 text-sm"
								>
									{emptyLabel}
								</div>
							) : null}
						</SessionListViewport>
						{selectedIds.size > 0 ? (
							<div
								data-qa-id="session-list-selection-hint"
								className="bg-popover text-muted-foreground mt-1 flex shrink-0 items-center gap-1.5 rounded-lg border py-1 pr-1 pl-2.5 text-xs"
							>
								<span className="flex-1">
									{selectedIds.size} selected · <Kbd>Esc</Kbd> to clear
								</span>
								<TooltipProvider delay={300}>
									<DropdownMenu>
										<MoreActionsTrigger
											aria-label="Selection actions"
											data-qa-id="session-list-selection-actions"
										/>
										<DropdownMenuContent side="top" align="end">
											<BulkMenuItems onDelete={deleteSelection} onDone={clearSelection} />
										</DropdownMenuContent>
									</DropdownMenu>
								</TooltipProvider>
							</div>
						) : null}
					</div>
				</section>
				<SessionBulkDeleteDialog
					targets={deleting}
					sessions={sessionsHandle}
					onClose={() => setDeleting(null)}
				/>
			</SessionListChromeContext>
		</div>
	);
}

/** Buttons plugins add to the list's header (kilo.work-sessions/work-session-list-action). */
function NavigatorActions() {
	const actions = useExtensions(WorkSessionListAction);
	if (actions.length === 0) return null;
	return (
		<>
			{actions.map((action) => (
				<RenderContribution key={action.key} contribution={action} />
			))}
		</>
	);
}

function NewSessionButton() {
	const workSessions = useDomainObject(WorkSessions);
	const window = useDomainObject(WorkSessionsWindow);
	const workspaces = useDomainObject(Workspaces);
	return (
		<SidebarMenuButton
			data-qa-id="new-chat"
			className="gap-2 rounded-lg"
			onClick={() => startNewWorkSession({ workSessions, window, workspaces })}
		>
			<MessageSquareIcon />
			<span>New session</span>
		</SidebarMenuButton>
	);
}

/**
 * Search filters in React rather than via cmdk: cmdk mounts every item and
 * rescans them on each keystroke, which lags with a long session history.
 * Capping each group keeps the mounted list small.
 */
const SEARCH_SESSION_RESULT_LIMIT = 50;

function matchesSearch(terms: readonly (string | null)[], query: string): boolean {
	if (!query) return true;
	return terms.some((term) => term?.toLowerCase().includes(query));
}

const SEARCH_SCOPES = ["all", "chats", "workspaces"] as const;
type SearchScope = (typeof SEARCH_SCOPES)[number];

const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
	all: "All",
	chats: "Sessions",
	workspaces: "Workspaces",
};

function isSearchScope(value: string | undefined): value is SearchScope {
	return value === "all" || value === "chats" || value === "workspaces";
}

function searchEmptyLabel(scope: SearchScope, emptyQuery: boolean): string {
	if (!emptyQuery) return "No results.";
	if (scope !== "workspaces") return "No recent sessions.";
	return "No workspaces yet.";
}

function workspacePrimaryFolderLabel(workspace: Workspace): string | null {
	const path =
		workspace.folders.find((folder) => folder.isPrimary)?.path ?? workspace.folders[0]?.path;
	return path ? directoryBasename(path) : null;
}

type SearchRow = {
	id: string;
	title: string;
	sublabel: string | null;
	updatedAt: number;
	archived: boolean;
};

function SearchSessionItem({
	row,
	onSelect,
}: {
	row: SearchRow;
	onSelect: (row: SearchRow) => void;
}) {
	return (
		<CommandItem
			data-qa-id={`session-search-session-${row.id}`}
			value={`chat:${row.id}`}
			onSelect={() => onSelect(row)}
		>
			<MessageSquareIcon />
			<span className="min-w-0 flex-1 truncate">{row.title}</span>
			<span className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
				{row.sublabel ? <span className="max-w-36 truncate">{row.sublabel}</span> : null}
				<span className="tabular-nums">
					<SessionRelativeTime timestamp={row.updatedAt} />
				</span>
			</span>
		</CommandItem>
	);
}

function SearchWorkspaceItem({
	workspace,
	onSelect,
}: {
	workspace: Workspace;
	onSelect: (id: string) => void;
}) {
	const glyph = workspaceGlyphColor(workspace.color);
	const sublabel = workspacePrimaryFolderLabel(workspace);
	return (
		<CommandItem
			data-qa-id={`session-search-workspace-${workspace.id}`}
			value={`workspace:${workspace.id}`}
			onSelect={() => onSelect(workspace.id)}
		>
			<FolderIcon {...(glyph ? { color: glyph } : {})} />
			<span className="min-w-0 flex-1 truncate">{workspace.name}</span>
			{sublabel ? (
				<span className="text-muted-foreground max-w-36 shrink-0 truncate text-xs">{sublabel}</span>
			) : null}
		</CommandItem>
	);
}

/** Every session as a search row, most recently updated first. */
function searchRows(
	sessions: readonly WorkSession[],
	workspaces: readonly Workspace[],
): readonly SearchRow[] {
	return sessions
		.map((session): SearchRow => ({
			id: session.id,
			title: session.title,
			sublabel: resolveSessionLocationLabel(activityOfSession(session), workspaces),
			updatedAt: session.updatedAt,
			archived: session.archived,
		}))
		.toSorted((left, right) => right.updatedAt - left.updatedAt);
}

interface SessionListSearchProps {
	sessions: readonly WorkSession[];
	workspaces: readonly Workspace[];
	onSelectSession: (sessionId: string) => void;
	onSelectWorkspace: (workspaceId: string) => void;
}

/** Search (⌘K): sessions, then archived ones, then workspaces. */
const SessionListSearch: FC<SessionListSearchProps> = ({ sessions, ...props }) => (
	// Rows are built here, apart from the query state, so typing filters them without rebuilding.
	<SessionListSearchDialog rows={searchRows(sessions, props.workspaces)} {...props} />
);

const SessionListSearchDialog: FC<
	Omit<SessionListSearchProps, "sessions"> & { rows: readonly SearchRow[] }
> = ({ rows, workspaces, onSelectSession, onSelectWorkspace }) => {
	const open = useWorkSessionSearchOpen();
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<SearchScope>("all");
	const { isUnavailable } = useWorkspacePickerSource();
	const showSessions = scope !== "workspaces";
	const showWorkspaces = scope !== "chats" && !isUnavailable;

	const [wasOpen, setWasOpen] = useState(open);
	if (wasOpen !== open) {
		setWasOpen(open);
		if (!open) {
			setQuery("");
			setScope("all");
		}
	}

	const normalizedQuery = query.trim().toLowerCase();
	const matchingRows = rows.filter((row) =>
		matchesSearch([row.title, row.sublabel], normalizedQuery),
	);
	const active = showSessions
		? matchingRows.filter((row) => !row.archived).slice(0, SEARCH_SESSION_RESULT_LIMIT)
		: [];
	const archived = showSessions
		? matchingRows.filter((row) => row.archived).slice(0, SEARCH_SESSION_RESULT_LIMIT)
		: [];
	const workspaceRows = showWorkspaces
		? workspaces.filter((workspace) =>
				matchesSearch([workspace.name, workspacePrimaryFolderLabel(workspace)], normalizedQuery),
			)
		: [];
	const emptyQuery = normalizedQuery.length === 0;
	const sessionHeading =
		scope === "all" || archived.length > 0
			? emptyQuery
				? "Recent sessions"
				: "Sessions"
			: undefined;
	const workspaceHeading = scope === "all" ? "Workspaces" : undefined;

	const selectSession = (row: SearchRow) => {
		workSessionSearch.close();
		onSelectSession(row.id);
	};
	const selectWorkspace = (id: string) => {
		workSessionSearch.close();
		onSelectWorkspace(id);
	};

	return (
		<>
			<SidebarMenuButton
				aria-label="Search"
				className="gap-2 rounded-lg"
				data-qa-id="session-list-search"
				onClick={workSessionSearch.open}
			>
				<SearchIcon />
				<span>Search</span>
			</SidebarMenuButton>
			<CommandDialog
				open={open}
				onOpenChange={workSessionSearch.set}
				title="Search"
				description="Search sessions and workspaces"
				showCloseButton
				className="top-1/2 -translate-y-1/2 sm:max-w-2xl"
			>
				<Command label="Search sessions and workspaces" shouldFilter={false}>
					<CommandInput
						value={query}
						onValueChange={setQuery}
						placeholder="Search sessions and workspaces"
						aria-label="Search sessions and workspaces"
						data-qa-id="session-search-input"
						className="pe-10"
					/>
					<ToggleGroup
						size="sm"
						spacing={1}
						value={[scope]}
						aria-label="Search in"
						className="px-4 pt-3 pb-1"
						onMouseDown={(event) => event.preventDefault()}
						onValueChange={(value) => {
							const next = value[0];
							if (isSearchScope(next)) setScope(next);
						}}
					>
						{SEARCH_SCOPES.map((item) => (
							<ToggleGroupItem key={item} value={item} data-qa-id={`session-search-filter-${item}`}>
								{SEARCH_SCOPE_LABELS[item]}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<CommandList className="scroll-fade-y h-96 px-2">
						<CommandEmpty>{searchEmptyLabel(scope, emptyQuery)}</CommandEmpty>
						{active.length > 0 ? (
							<CommandGroup heading={sessionHeading}>
								{active.map((row) => (
									<SearchSessionItem key={row.id} row={row} onSelect={selectSession} />
								))}
							</CommandGroup>
						) : null}
						{archived.length > 0 ? (
							<>
								{active.length > 0 ? <CommandSeparator /> : null}
								<CommandGroup heading="Archived">
									{archived.map((row) => (
										<SearchSessionItem key={row.id} row={row} onSelect={selectSession} />
									))}
								</CommandGroup>
							</>
						) : null}
						{workspaceRows.length > 0 ? (
							<>
								{active.length > 0 || archived.length > 0 ? <CommandSeparator /> : null}
								<CommandGroup
									heading={workspaceHeading}
									className="in-data-[slot=dialog-content]:**:[[cmdk-group-heading]]:px-0"
								>
									{workspaceRows.map((workspace) => (
										<SearchWorkspaceItem
											key={workspace.id}
											workspace={workspace}
											onSelect={selectWorkspace}
										/>
									))}
								</CommandGroup>
							</>
						) : null}
					</CommandList>
				</Command>
			</CommandDialog>
		</>
	);
};

const shelfMutedTone = {
	label: "text-muted-foreground",
	chevron: "text-muted-foreground",
} as const;

const shelfHeaderTones = {
	attention: { label: "text-warning", chevron: "text-warning" },
	active: shelfMutedTone,
	archived: shelfMutedTone,
	workspace: shelfMutedTone,
	pinned: shelfMutedTone,
	updated: shelfMutedTone,
} as const;

const SessionShelfHeader: FC<{
	tone: SessionListSection["tone"];
	label: string;
	workspace?: Workspace | undefined;
	onNewSessionInWorkspace: (workspaceId: string) => void;
	expanded: boolean;
	onToggle: () => void;
}> = ({ tone, label, workspace, onNewSessionInWorkspace, expanded, onToggle }) => {
	const classes = shelfHeaderTones[tone];
	const glyph = workspaceGlyphColor(workspace?.color);
	const WorkspaceFolderIcon = expanded ? FolderOpenIcon : FolderIcon;
	const qaId =
		tone === "workspace" ? "session-list-workspace-toggle" : `session-list-${tone}-toggle`;
	return (
		<div
			className={cn(
				"flex items-center",
				tone === "workspace" &&
					"group/workspace-row hover:bg-sidebar-accent focus-within:bg-sidebar-accent rounded-md",
			)}
			data-slot={`session-list-${tone}-header`}
		>
			<Button
				type="button"
				variant="ghost"
				onClick={onToggle}
				aria-expanded={expanded}
				data-qa-id={qaId}
				className={cn(
					"group/shelf h-[30px] min-w-0 flex-1 justify-start gap-2 bg-transparent px-2 font-normal hover:bg-transparent aria-expanded:bg-transparent",
					sidebarNavRadiusClassName,
				)}
			>
				{tone === "workspace" ? (
					<WorkspaceFolderIcon
						aria-hidden
						className="size-3.5 shrink-0"
						{...(glyph ? { color: glyph } : {})}
					/>
				) : tone === "archived" ? (
					<ArchiveIcon aria-hidden className="size-3.5 shrink-0" />
				) : tone === "pinned" ? (
					<PinIcon aria-hidden className="size-3.5 shrink-0" />
				) : null}
				<span className={cn("min-w-0 truncate text-sm font-normal", classes.label)}>{label}</span>
				{tone === "workspace" ? null : (
					<ChevronDownIcon
						aria-hidden
						className={cn(
							"size-3 opacity-0 transition-transform group-hover/shelf:opacity-100 group-focus-visible/shelf:opacity-100",
							classes.chevron,
							!expanded && "-rotate-90",
						)}
					/>
				)}
			</Button>
			{tone === "workspace" && workspace ? (
				<WorkspaceShelfActions
					workspace={workspace}
					onNewSessionInWorkspace={onNewSessionInWorkspace}
				/>
			) : null}
		</div>
	);
};

const WorkspaceShelfActions: FC<{
	workspace: Workspace;
	onNewSessionInWorkspace: (workspaceId: string) => void;
}> = ({ workspace, onNewSessionInWorkspace }) => {
	const { openEdit, openDelete } = useWorkspacePickerSource();

	return (
		<TooltipProvider delay={300}>
			<div
				className={workspaceHeaderActionsClassName}
				data-qa-id={`session-list-workspace-controls-${workspace.id}`}
			>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger
							render={
								<DropdownMenuTrigger
									render={
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label={`Workspace actions for ${workspace.name}`}
											data-qa-id={`session-list-workspace-actions-${workspace.id}`}
										/>
									}
								/>
							}
						>
							<EllipsisIcon aria-hidden className="size-3.5" />
						</TooltipTrigger>
						<TooltipContent side="bottom">More</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" side="right">
						<DropdownMenuItem onClick={() => openEdit(workspace)}>
							<PencilIcon />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem variant="destructive" onClick={() => openDelete(workspace)}>
							<Trash2Icon />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={`New session in ${workspace.name}`}
								data-qa-id={`session-list-workspace-new-${workspace.id}`}
								onClick={() => onNewSessionInWorkspace(workspace.id)}
							/>
						}
					>
						<PlusIcon aria-hidden className="size-3.5" />
					</TooltipTrigger>
					<TooltipContent side="bottom">New session</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	);
};

/** Mirrors an indented row's glyph slot so the note lines up with session titles. */
const WorkspaceEmptyRow: FC<{ workspaceId: string; label: string }> = ({ workspaceId, label }) => (
	<div
		data-qa-id={`session-list-workspace-empty-${workspaceId}`}
		className="mx-px box-content flex h-5 min-w-0 items-center gap-1.5 py-1 pr-2.5 pl-2 select-none"
	>
		<span aria-hidden className="w-4 shrink-0" />
		<span className="text-muted-foreground/60 min-w-0 flex-1 truncate text-sm">{label}</span>
	</div>
);

interface SessionListViewportHandle {
	readonly scrollToIndex: (index: number) => void;
}

/**
 * The scrolling inbox and its virtualized rows. It renders the scroll element
 * itself so that element's ref is attached before the virtualizer's layout
 * effect reads it.
 */
function SessionListViewport({
	handleRef,
	listRef,
	entries,
	renderEntry,
	onKeyDown,
	onClick,
	children,
}: {
	readonly handleRef: Ref<SessionListViewportHandle>;
	readonly listRef: RefObject<HTMLDivElement | null>;
	readonly entries: readonly VirtualSessionListEntry[];
	readonly renderEntry: (entry: VirtualSessionListEntry) => ReactNode;
	readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	readonly onClick: (event: MouseEvent<HTMLDivElement>) => void;
	readonly children: ReactNode;
}) {
	"use no memo"; // useVirtualizer returns a mutable instance the compiler cannot memoize around.
	const virtualizer = useVirtualizer({
		count: entries.length,
		getScrollElement: () => listRef.current,
		estimateSize: (index) => {
			const entry = entries[index];
			const baseSize = entry?.kind === "header" ? SESSION_SHELF_HEADER_PX : SESSION_ROW_ESTIMATE_PX;
			return baseSize + (entry?.spaceBefore ? SESSION_SECTION_GAP_PX : 0);
		},
		getItemKey: (index) => entries[index]?.key ?? index,
		overscan: SESSION_LIST_OVERSCAN,
		gap: 1,
	});
	useImperativeHandle(
		handleRef,
		() => ({ scrollToIndex: (index) => virtualizer.scrollToIndex(index) }),
		[virtualizer],
	);

	return (
		<div
			ref={listRef}
			data-qa-id="session-list-inbox"
			onKeyDown={onKeyDown}
			onClick={onClick}
			className="scroll-fade no-scrollbar relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
		>
			{entries.length > 0 ? (
				<ul
					role="list"
					className="relative w-full min-w-0"
					style={{ height: virtualizer.getTotalSize() }}
					data-qa-id="session-list-virtual-list"
				>
					{virtualizer.getVirtualItems().map((virtualItem) => {
						const entry = entries[virtualItem.index];
						if (!entry) return null;
						return (
							<li
								key={entry.key}
								ref={virtualizer.measureElement}
								data-index={virtualItem.index}
								aria-posinset={virtualItem.index + 1}
								aria-setsize={entries.length}
								className="absolute top-0 left-0 w-full min-w-0 list-none"
								style={{ transform: `translateY(${virtualItem.start}px)` }}
							>
								{renderEntry(entry)}
							</li>
						);
					})}
				</ul>
			) : null}
			{children}
		</div>
	);
}

function SessionRowSlot({
	session,
	indented,
}: {
	session: WorkSession | undefined;
	indented: boolean;
}) {
	if (!session) return null;
	return <SessionRow session={session} indented={indented} />;
}

function SessionRow({ session, indented }: { session: WorkSession; indented: boolean }) {
	const {
		show,
		activeWorkSessionId,
		workspaces,
		sessions,
		open,
		intendToOpen,
		cancelIntentToOpen,
		activities,
		visits,
		shortcutHints,
		selectedIds,
		selectRow,
		clearSelection,
		deleteSelection,
	} = use(SessionListChromeContext);
	const isSelected = selectedIds.has(session.id);
	const isBulk = isSelected && selectedIds.size > 1;
	// Fixed when the menu opens, so acting on the selection doesn't swap its items while it closes.
	const [bulkMenu, setBulkMenu] = useState(false);
	const { isRenaming, startRename, finishRename, triggerRef } = useRenameState();
	const { togglePinned, setArchived, askToDelete, dialogs } = useSessionActions(session);
	const dragSource = dragSourceProps([{ type: WorkSessionObjectType.id, id: session.id }], {
		disabled: isRenaming,
	});
	const isActive = session.id === activeWorkSessionId;
	const activity = activities[session.id] ?? activityOfSession(session);
	const rowState = deriveSessionRowState(activity, lastVisitedOf(visits, session));
	const shortcutHint = shortcutHints.get(session.id);
	const { isArchived } = sessionRowCapabilities(session.archived, rowState);
	const locationLabel = resolveSessionLocationLabel(activity, workspaces);
	const workspace = workspaces.find((candidate) => candidate.id === session.workspaceId);
	const workspaceColor = workspaceGlyphColor(workspace?.color);
	const showWorkspace = show.includes("workspace") && locationLabel !== null;

	const decorations = useExtensions(WorkSessionDecoration).filter(
		(decoration) => decoration.metadata.slot === "row",
	);
	// The "PR" view option shows row decorations; git's pull request badge is the first (step 9).
	const rowDecorations =
		show.includes("pr") && decorations.length > 0
			? decorations.map((decoration) => (
					<RenderContribution
						key={decoration.key}
						contribution={decoration}
						props={{ workSession: session }}
					/>
				))
			: null;
	// Without a workspace label the info line would hold only the decorations,
	// stranded on their own line — they join the title row's trailing slot
	// instead, fading under the hover actions like the timestamp.
	const decorationsInTitleRow = !showWorkspace && rowDecorations !== null;
	const updatedAt = show.includes("updated") ? session.updatedAt : undefined;

	const leadingIcon =
		rowState !== null ? (
			<SessionRowGlyph
				rowState={rowState}
				isActive={isActive}
				workingSince={activity.workingSince}
			/>
		) : (
			<span className="inline-flex size-3.5 shrink-0" aria-hidden />
		);
	const glyph = indented ? (
		<span className="flex h-5 w-4 shrink-0 items-center justify-center">{leadingIcon}</span>
	) : (
		leadingIcon
	);
	const rightSlot =
		updatedAt !== undefined ? (
			<span data-qa-id="session-list-item-updated" className={narrowRowYieldsTimeClassName}>
				<SessionRelativeTime timestamp={updatedAt} />
			</span>
		) : null;

	const titleRow = (
		<span className={cn("flex h-5 min-w-0 items-center", indented ? "gap-1.5" : "gap-2")}>
			{glyph}
			<span
				data-qa-id="session-list-item-title"
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					// sidebar-accent-foreground is a muted storm step for filled
					// accent chips; titles sit on a faint wash, so hover/selected
					// use full sidebar-foreground.
					isArchived && !isActive
						? "text-muted-foreground group-hover/sidebar-row:text-sidebar-foreground"
						: isActive
							? "text-sidebar-foreground"
							: "text-sidebar-foreground/85 group-hover/sidebar-row:text-sidebar-foreground",
				)}
			>
				{session.title}
			</span>
			<span
				className={cn(
					"text-muted-foreground ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end gap-1 text-xs leading-4 tabular-nums",
					rightSlot || decorationsInTitleRow ? rowHoverLabelFadeClassName : null,
				)}
			>
				{shortcutHint ? (
					<ShortcutHintChip label={shortcutHint} />
				) : (
					<>
						{decorationsInTitleRow ? (
							<span className="peer/pr contents">{rowDecorations}</span>
						) : null}
						{rightSlot}
					</>
				)}
			</span>
		</span>
	);

	const infoLine = showWorkspace ? (
		<span
			data-qa-id="session-list-item-info"
			className={cn(
				"text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-xs leading-4",
				indented && "ml-1.5 pl-4",
			)}
		>
			<FolderIcon
				aria-hidden
				className="size-[13px] shrink-0 opacity-70"
				{...(workspaceColor ? { color: workspaceColor } : {})}
			/>
			<span className="min-w-0 flex-1 truncate">{locationLabel}</span>
			{rowDecorations}
		</span>
	) : null;

	const rowPad = indented ? "pl-2 pr-2.5" : "px-2.5";

	return (
		<ContextMenu.Root
			onOpenChange={(menuOpen) => {
				if (!menuOpen) return;
				setBulkMenu(isBulk);
				// As in Finder: right-clicking outside the selection acts on that session alone.
				if (!isSelected) clearSelection();
			}}
		>
			<ContextMenu.Trigger
				{...dragSource}
				data-session-id={session.id}
				data-qa-id={isArchived ? "session-list-archived-item" : "session-list-item"}
				data-active={isActive || undefined}
				data-selected={isSelected || undefined}
				onPointerEnter={isActive ? undefined : () => intendToOpen(session.id)}
				onPointerLeave={cancelIntentToOpen}
				className={cn(
					"group/sidebar-row @container/session-row relative mx-px min-w-0 cursor-pointer rounded-md text-left outline-none select-none",
					isSelected
						? sidebarSurfaceMultiSelectedClassName
						: isActive
							? sidebarSurfaceActiveClassName
							: sidebarSurfaceIdleClassName,
				)}
			>
				{isRenaming ? (
					<div className={cn("flex h-7 items-center", rowPad)}>
						<SessionRenameInput
							title={session.title}
							onRename={async (title) => sessions?.methods.rename({ id: session.id, title })}
							onDone={finishRename}
						/>
					</div>
				) : (
					<SessionRowHoverCard
						session={session}
						title={session.title}
						activity={activity}
						locationLabel={locationLabel}
						workspaceColor={workspaceColor}
						trigger={
							<button
								ref={triggerRef}
								type="button"
								data-qa-id="session-list-item-trigger"
								data-sidebar-select
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex w-full flex-col py-1 text-left focus-visible:outline-none",
									rowPad,
								)}
								onClick={(event) => {
									if (event.metaKey || event.ctrlKey || event.shiftKey) {
										selectRow(session.id, event.shiftKey);
										return;
									}
									clearSelection();
									open(session.id);
								}}
							>
								<span className="flex min-w-0 -translate-y-px flex-col">
									{titleRow}
									{infoLine}
								</span>
								{isSelected ? <span className="sr-only">, selected</span> : null}
							</button>
						}
					/>
				)}
				{isRenaming ? null : (
					<TooltipProvider delay={300}>
						<span className={cn(rowHoverActionsClassName, "top-1 right-1.5 h-5")}>
							<SessionRowMenu
								session={session}
								onPin={togglePinned}
								onRename={startRename}
								onArchive={() => setArchived(true)}
								onRestore={() => setArchived(false)}
								onDelete={askToDelete}
							/>
						</span>
					</TooltipProvider>
				)}
				{dialogs}
			</ContextMenu.Trigger>
			{/* Always mounted: unmounting it mid-close leaves Base UI's menu stuck open on remount. */}
			<DropdownMenuContent side="bottom" align="start">
				{bulkMenu ? (
					<BulkMenuItems onDelete={deleteSelection} onDone={clearSelection} />
				) : (
					<SessionRowMenuItems
						session={session}
						onPin={togglePinned}
						onRename={startRename}
						onArchive={() => setArchived(true)}
						onRestore={() => setArchived(false)}
						onDelete={askToDelete}
					/>
				)}
			</DropdownMenuContent>
		</ContextMenu.Root>
	);
}

/** Mounted while the right-click menu is open, so it reads the selection's current state. */
function BulkMenuItems({ onDelete, onDone }: { onDelete: () => void; onDone: () => void }) {
	const { selectedIds, sessions, activities, visits } = use(SessionListChromeContext);
	const targets = (sessions?.getState().workSessions ?? [])
		.filter((session) => selectedIds.has(session.id))
		.map((session) => ({
			session,
			canArchive: sessionRowCapabilities(
				session.archived,
				deriveSessionRowState(
					activities[session.id] ?? activityOfSession(session),
					lastVisitedOf(visits, session),
				),
			).canArchive,
		}));
	return (
		<SessionBulkMenuItems
			targets={targets}
			sessions={sessions}
			onDone={onDone}
			onDelete={onDelete}
		/>
	);
}
