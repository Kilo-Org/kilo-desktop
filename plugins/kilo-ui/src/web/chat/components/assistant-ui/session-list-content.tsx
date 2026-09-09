"use client";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@anaconda-agentic-desktop/ui/components/command";
import { ToggleGroup, ToggleGroupItem } from "@anaconda-agentic-desktop/ui/components/toggle-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import {
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAui,
	useAuiState,
	type ThreadListItemStatus,
} from "@assistant-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	CheckIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	FolderIcon,
	Loader2Icon,
	MessageCircleQuestionIcon,
	MessageSquareIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	PlusIcon,
	SearchIcon,
	Trash2Icon,
	Undo2Icon,
} from "lucide-react";
import isEqual from "lodash/isEqual.js";
import {
	createContext,
	memo,
	use,
	useEffect,
	useCallback,
	useMemo,
	useRef,
	useState,
	type FC,
	type ReactNode,
} from "react";

import type { Workspace } from "../../../../contracts/workspaces/schemas.js";
import { GlobalNewButton } from "../../../create/GlobalNewButton.js";
import { WorkspaceFilter } from "../../../workspaces/WorkspaceFilter.js";
import {
	useWorkspacesFeature,
	type WorkspacesContextValue,
} from "../../../workspaces/WorkspacesFeatureContext.js";
import { workspaceGlyphColor } from "../../../workspaces/workspace-glyph-style.js";
import { navigateToChat } from "../../chat-navigation.js";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "../../right-panel/right-panel-store.js";
import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import {
	deriveSessionRowState,
	directoryBasename,
	formatRelativeTimeLabel,
	formatWorkingDurationLabel,
	resolveSessionLocationLabel,
	type SessionActivity,
	type SessionRowState,
} from "../../session-activity/session-activity-logic.js";
import { SessionListViewMenu } from "../../session-list/session-list-view-menu.js";
import {
	buildSessionListSections,
	SESSION_LIST_GROUPING_LABELS,
	resolveSessionListGrouping,
	visibleShowFields,
	type SessionListSection,
	type SessionListSectionRow,
	type SessionListShowField,
	type SessionListView,
} from "../../session-list/session-list-view.js";
/** Hide CommandItem's built-in check — opacity-0 still reserves layout space. */
const HIDE_BUILTIN_CHECK = "[&>svg:last-child]:hidden";

/**
 * Shared surface states for session rows.
 * Idle is clear; hover, focus, and selected states use the same translucent wash.
 */
const sidebarSurfaceIdleClassName =
	"bg-transparent text-sidebar-foreground transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5";
const sidebarSurfaceActiveClassName =
	"bg-foreground/5 text-sidebar-foreground font-medium transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5";

/** Override Button/Input `rounded-lg` so radius matches sidebar menu items. */
const sidebarNavRadiusClassName = "rounded-md!";

/**
 * Hover actions sit over the status slot: hidden until row hover, keyboard
 * focus, or an open dropdown, then cross-fade with the status label (which
 * fades out via the matching group classes on the label itself).
 */
const rowHoverActionsClassName =
	"pointer-events-none absolute flex items-center opacity-0 transition-opacity group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

const rowHoverLabelFadeClassName =
	"group-hover/sidebar-row:opacity-0 group-has-[:focus-visible]/sidebar-row:opacity-0 group-has-[[data-popup-open]]/sidebar-row:opacity-0";

const workspaceHeaderActionsClassName =
	"pointer-events-none mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/workspace-row:pointer-events-auto group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:pointer-events-auto group-focus-within/workspace-row:opacity-100 group-has-[[data-popup-open]]/workspace-row:pointer-events-auto group-has-[[data-popup-open]]/workspace-row:opacity-100";

const SESSION_LIST_OVERSCAN = 10;
const SESSION_ROW_ESTIMATE_PX = 32;
const SESSION_SHELF_HEADER_PX = 28;
const SESSION_SECTION_GAP_PX = 8;

const SessionListChromeContext = createContext<{
	show: readonly SessionListShowField[];
	pinnedIds: ReadonlySet<string>;
	togglePin: (id: string) => void;
}>({ show: [], pinnedIds: new Set(), togglePin: () => undefined });

const SessionRowIndentContext = createContext(false);

/**
 * Resolve ItemByIndex from a stable thread id. Virtual rows are keyed by id,
 * while assistant-ui addresses items by their current list index.
 */
const SessionListItemSlot: FC<{
	id: string;
	archived?: boolean;
}> = ({ id, archived = false }) => {
	const index = useAuiState((s) => {
		const ids = archived ? s.threads.archivedThreadIds : s.threads.threadIds;
		return ids.indexOf(id);
	});
	if (index < 0) return null;
	return (
		<ThreadListPrimitive.ItemByIndex
			index={index}
			archived={archived}
			components={{ ThreadListItem: SessionRow }}
		/>
	);
};

type SessionListContentProps = {
	view: SessionListView;
	updateView: (patch: Partial<SessionListView>) => void;
	resetView: () => void;
	pinIds: readonly string[];
	togglePin: (id: string) => void;
	threadIds: readonly string[];
	archivedThreadIds: readonly string[];
	threadItems: readonly SessionListThreadItem[];
	isLoading: boolean;
	activityBySessionId: Readonly<Record<string, SessionActivity>>;
	workspaces: readonly Workspace[];
	setActiveWorkspaceId: WorkspacesContextValue["setActiveWorkspaceId"];
};

type SessionListThreadItem = ReturnType<
	ReturnType<typeof useAui>["threads"]["getState"]
>["threadItems"][number];

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
	  };

function flattenSessionListSections(
	sections: readonly SessionListSection[],
	expanded: Readonly<Record<string, boolean>>,
	options: { spaceBeforeFirst: boolean },
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

export const SessionListContent = memo(function SessionListContent({
	view,
	updateView,
	resetView,
	pinIds,
	togglePin,
	threadIds,
	archivedThreadIds,
	threadItems,
	isLoading,
	activityBySessionId,
	workspaces,
	setActiveWorkspaceId,
}: SessionListContentProps) {
	const aui = useAui();
	const navigate = useNavigateToChat();
	const pinnedIds = useMemo(() => new Set(pinIds), [pinIds]);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const focus =
		view.focus && workspaces.some((workspace) => workspace.id === view.focus) ? view.focus : null;
	const resolvedView = useMemo(
		() => (focus === view.focus ? view : { ...view, focus }),
		[focus, view],
	);
	const show = useMemo(() => visibleShowFields(resolvedView), [resolvedView]);
	const chrome = useMemo(() => ({ show, pinnedIds, togglePin }), [pinnedIds, show, togglePin]);

	const sections = useMemo(() => {
		const itemsById = new Map(threadItems.map((item) => [item.id, item]));
		const toEntry = (id: string, sourceIndex: number, archived: boolean) => {
			const item = itemsById.get(id);
			return {
				id,
				remoteId: item?.remoteId,
				title: item?.title,
				sourceIndex,
				archived,
			};
		};
		const entries = [
			...threadIds.map((id, index) => toEntry(id, index, false)),
			...archivedThreadIds.map((id, index) => toEntry(id, index, true)),
		];
		return buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view: resolvedView,
			pinnedIds,
		});
	}, [
		activityBySessionId,
		archivedThreadIds,
		pinnedIds,
		resolvedView,
		threadIds,
		threadItems,
		workspaces,
	]);

	const [pinnedSections, groupedSections] = useMemo(
		() => [
			sections.filter((section) => section.tone === "pinned"),
			sections.filter((section) => section.tone !== "pinned"),
		],
		[sections],
	);
	const collapsibleKeys = sections.flatMap((section) => (section.label ? [section.key] : []));
	const allCollapsed =
		collapsibleKeys.length > 0 && collapsibleKeys.every((key) => expanded[key] === false);
	const focusedWorkspace = focus
		? workspaces.find((workspace) => workspace.id === focus)
		: undefined;
	const emptyLabel = focusedWorkspace ? `No chats in ${focusedWorkspace.name}` : null;
	const groupingLabel = SESSION_LIST_GROUPING_LABELS[resolveSessionListGrouping(resolvedView)];
	const createChatInWorkspace = useCallback(
		(workspaceId: string) => {
			useRightPanelStore.getState().clearSession(DRAFT_RIGHT_PANEL_SESSION_KEY);
			setActiveWorkspaceId(workspaceId);
			void aui.threads.switchToNewThread();
			navigate();
		},
		[aui, navigate, setActiveWorkspaceId],
	);
	const listRef = useRef<HTMLDivElement>(null);
	const virtualEntries = useMemo(() => {
		const entries: VirtualSessionListEntry[] = [];
		entries.push(
			...flattenSessionListSections(pinnedSections, expanded, {
				spaceBeforeFirst: false,
			}),
			...flattenSessionListSections(groupedSections, expanded, {
				spaceBeforeFirst: pinnedSections.length > 0,
			}),
		);
		return entries;
	}, [expanded, groupedSections, pinnedSections]);
	const virtualizer = useVirtualizer({
		count: virtualEntries.length,
		getScrollElement: () => listRef.current,
		estimateSize: (index) => {
			const entry = virtualEntries[index];
			const baseSize = entry?.kind === "row" ? SESSION_ROW_ESTIMATE_PX : SESSION_SHELF_HEADER_PX;
			return baseSize + (entry?.spaceBefore ? SESSION_SECTION_GAP_PX : 0);
		},
		getItemKey: (index) => virtualEntries[index]?.key ?? index,
		overscan: SESSION_LIST_OVERSCAN,
		gap: 1,
	});
	useEffect(() => {
		listRef.current?.scrollTo({ top: 0 });
	}, [resolvedView.focus, resolvedView.grouping, resolvedView.ordering, resolvedView.status]);

	const viewMenu = (
		<SessionListViewMenu
			view={resolvedView}
			onViewChange={updateView}
			onReset={resetView}
			canCollapse={collapsibleKeys.length > 0}
			allCollapsed={allCollapsed}
			onCollapseAll={() => {
				setExpanded(Object.fromEntries(collapsibleKeys.map((key) => [key, false])));
			}}
			onExpandAll={() => {
				setExpanded(Object.fromEntries(collapsibleKeys.map((key) => [key, true])));
			}}
		/>
	);

	return (
		<div data-qa-id="kilo-thread-list" className="flex min-h-0 flex-1 flex-col">
			<SessionListChromeContext value={chrome}>
				<ThreadListPrimitive.Root
					data-slot="aui_thread-list-root"
					className="flex min-h-0 flex-1 flex-col"
				>
					<div className="mb-2 flex shrink-0 flex-col gap-0.5">
						<GlobalNewButton />
					</div>
					<div
						data-qa-id="session-list-inbox-header"
						className="mb-2 flex h-8 shrink-0 items-center"
					>
						<WorkspaceFilter
							value={focus}
							onValueChange={(id) => {
								updateView({ focus: id });
								if (id) setActiveWorkspaceId(id);
							}}
						/>
					</div>
					<div
						data-qa-id="session-list-grouping-header"
						className="mb-1 flex h-7 shrink-0 items-center pl-2"
					>
						<h2 className="text-muted-foreground text-[13px] font-medium">{groupingLabel}</h2>
						<div className="ml-auto flex items-center">{viewMenu}</div>
					</div>
					<div
						ref={listRef}
						data-slot="aui_thread-list-items"
						data-qa-id="session-list-inbox"
						className="scroll-fade no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
					>
						{isLoading ? <SessionListSkeleton /> : null}
						{!isLoading && virtualEntries.length > 0 ? (
							<ul
								role="list"
								className="relative w-full"
								style={{ height: virtualizer.getTotalSize() }}
								data-qa-id="session-list-virtual-list"
							>
								{virtualizer.getVirtualItems().map((virtualItem) => {
									const entry = virtualEntries[virtualItem.index];
									if (!entry) return null;
									return (
										<li
											key={entry.key}
											ref={virtualizer.measureElement}
											data-index={virtualItem.index}
											aria-posinset={virtualItem.index + 1}
											aria-setsize={virtualEntries.length}
											className={cn(
												"absolute top-0 left-0 w-full list-none",
												entry.spaceBefore && "pt-2",
											)}
											style={{ transform: `translateY(${virtualItem.start}px)` }}
										>
											<div>
												{entry.kind === "header" ? (
													<SessionShelfHeader
														tone={entry.tone}
														label={entry.label}
														workspace={
															entry.workspaceId
																? workspaces.find((workspace) => workspace.id === entry.workspaceId)
																: undefined
														}
														onCreateChatInWorkspace={createChatInWorkspace}
														expanded={entry.expanded}
														onToggle={() => {
															setExpanded((current) => ({
																...current,
																[entry.sectionKey]: !entry.expanded,
															}));
														}}
													/>
												) : (
													<SessionRowIndentContext value={entry.indented}>
														<SessionListItemSlot id={entry.row.id} archived={entry.row.archived} />
													</SessionRowIndentContext>
												)}
											</div>
										</li>
									);
								})}
							</ul>
						) : null}
						{!isLoading && emptyLabel && sections.length === 0 ? (
							<div
								data-slot="aui_thread-list-empty"
								className="text-muted-foreground px-2.5 py-4 text-sm"
							>
								{emptyLabel}
							</div>
						) : null}
					</div>
				</ThreadListPrimitive.Root>
			</SessionListChromeContext>
		</div>
	);
}, isEqual);

function useNavigateToChat(): () => void {
	const sdk = useSdk("kilo-ui");
	return useCallback(() => navigateToChat(sdk), [sdk]);
}

function filterSearchItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

const SEARCH_SCOPES = ["all", "chats", "workspaces"] as const;
type SearchScope = (typeof SEARCH_SCOPES)[number];

const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
	all: "All",
	chats: "Chats",
	workspaces: "Workspaces",
};

function isSearchScope(value: string | undefined): value is SearchScope {
	return value === "all" || value === "chats" || value === "workspaces";
}

function searchEmptyLabel(scope: SearchScope, emptyQuery: boolean, isLoading: boolean): string {
	if (!emptyQuery) return "No results.";
	if (scope !== "workspaces") return "No recent chats.";
	if (isLoading) return "Loading workspaces…";
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
	updatedAt: number | undefined;
	archived: boolean;
};

function SearchChatItem({ row, onSelect }: { row: SearchRow; onSelect: (row: SearchRow) => void }) {
	return (
		<CommandItem
			value={`chat:${row.id}`}
			keywords={row.sublabel ? [row.title, row.sublabel] : [row.title]}
			onSelect={() => onSelect(row)}
			className={HIDE_BUILTIN_CHECK}
		>
			<MessageSquareIcon />
			<span className="min-w-0 flex-1 truncate">{row.title}</span>
			<span className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
				{row.sublabel ? <span className="max-w-36 truncate">{row.sublabel}</span> : null}
				{row.updatedAt ? (
					<span className="tabular-nums">{formatRelativeTimeLabel(row.updatedAt, Date.now())}</span>
				) : null}
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
			keywords={sublabel ? [workspace.name, sublabel] : [workspace.name]}
			onSelect={() => onSelect(workspace.id)}
			className={HIDE_BUILTIN_CHECK}
		>
			<FolderIcon {...(glyph ? { color: glyph } : {})} />
			<span className="min-w-0 flex-1 truncate">{workspace.name}</span>
			{sublabel ? (
				<span className="text-muted-foreground max-w-36 shrink-0 truncate text-xs">{sublabel}</span>
			) : null}
		</CommandItem>
	);
}

export const SessionListSearch: FC<{
	onSelectWorkspace: (workspaceId: string) => void;
}> = ({ onSelectWorkspace }) => {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<SearchScope>("all");
	const aui = useAui();
	const sdk = useSdk("kilo-ui");
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const activityBySessionId = useSessionActivity((s) => s.sessions);
	const { isLoading, isUnavailable, workspaces } = useWorkspacesFeature();
	const showChats = scope !== "workspaces";
	const showWorkspaces = scope !== "chats" && !isUnavailable;

	useEffect(() => {
		if (open) return;
		setQuery("");
		setScope("all");
	}, [open]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "k") return;
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
			event.preventDefault();
			setOpen((current) => !current);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const rows = useMemo(() => {
		const itemsById = new Map(threadItems.map((item) => [item.id, item]));
		const toRow = (id: string, archived: boolean): SearchRow => {
			const item = itemsById.get(id);
			const remoteId = item?.remoteId;
			const activity = remoteId ? activityBySessionId[remoteId] : undefined;
			return {
				id,
				title: item?.title || "New Chat",
				sublabel: resolveSessionLocationLabel(activity, workspaces),
				updatedAt: activity?.updatedAt,
				archived,
			};
		};
		return [
			...threadIds.map((id) => toRow(id, false)),
			...archivedThreadIds.map((id) => toRow(id, true)),
		];
	}, [activityBySessionId, archivedThreadIds, threadIds, threadItems, workspaces]);

	const chats = showChats ? rows.filter((row) => !row.archived) : [];
	const settled = showChats ? rows.filter((row) => row.archived) : [];
	const workspaceRows = showWorkspaces ? workspaces : [];
	const emptyQuery = query.trim().length === 0;
	const emptyLabel = searchEmptyLabel(scope, emptyQuery, isLoading);

	const handleSelectChat = (row: SearchRow) => {
		setOpen(false);
		void aui.threads.switchToThread(row.id, { unarchive: !row.archived });
		navigateToChat(sdk);
	};

	const handleSelectWorkspace = (id: string) => {
		setOpen(false);
		onSelectWorkspace(id);
	};

	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Search"
							className={sidebarNavRadiusClassName}
							data-slot="aui_thread-list-search"
							data-qa-id="session-list-search"
							onClick={() => setOpen(true)}
						/>
					}
				>
					<SearchIcon />
				</TooltipTrigger>
				<TooltipContent side="bottom">Search</TooltipContent>
			</Tooltip>
			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				title="Search"
				description="Search chats and workspaces"
				showCloseButton
				className="top-1/2 -translate-y-1/2"
			>
				<Command label="Search chats and workspaces" filter={filterSearchItems}>
					<CommandInput
						value={query}
						onValueChange={setQuery}
						placeholder="Search chats, workspaces…"
						aria-label="Search chats and workspaces"
						className="pe-10"
					/>
					<ToggleGroup
						size="sm"
						spacing={1}
						value={[scope]}
						aria-label="Search in"
						className="px-4 pt-0.5 pb-3.5"
						onMouseDown={(event) => event.preventDefault()}
						onValueChange={(value) => {
							const next = value[0];
							if (isSearchScope(next)) setScope(next);
						}}
					>
						{SEARCH_SCOPES.map((item) => (
							<ToggleGroupItem
								key={item}
								value={item}
								data-qa-id={`session-search-filter-${item}`}
								className="hover:bg-secondary hover:text-secondary-foreground"
							>
								{SEARCH_SCOPE_LABELS[item]}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<CommandSeparator />
					<CommandList>
						<CommandEmpty>{emptyLabel}</CommandEmpty>
						{chats.length > 0 ? (
							<CommandGroup heading={emptyQuery ? "Recent chats" : "Chats"}>
								{chats.map((row) => (
									<SearchChatItem key={row.id} row={row} onSelect={handleSelectChat} />
								))}
							</CommandGroup>
						) : null}
						{settled.length > 0 ? (
							<>
								{chats.length > 0 ? <CommandSeparator /> : null}
								<CommandGroup heading="Settled">
									{settled.map((row) => (
										<SearchChatItem key={row.id} row={row} onSelect={handleSelectChat} />
									))}
								</CommandGroup>
							</>
						) : null}
						{workspaceRows.length > 0 ? (
							<>
								{chats.length > 0 || settled.length > 0 ? <CommandSeparator /> : null}
								<CommandGroup heading="Workspaces">
									{workspaceRows.map((workspace) => (
										<SearchWorkspaceItem
											key={workspace.id}
											workspace={workspace}
											onSelect={handleSelectWorkspace}
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

const SessionListSkeleton: FC = () => {
	return (
		<div className="flex flex-col gap-0.5">
			{Array.from({ length: 5 }, (_, i) => (
				<div
					key={i}
					role="status"
					aria-label="Loading threads"
					data-slot="aui_thread-list-skeleton-wrapper"
					className="flex h-8 items-center px-2"
				>
					<Skeleton
						data-slot="aui_thread-list-skeleton"
						className="bg-sidebar-border h-3.5 w-full"
					/>
				</div>
			))}
		</div>
	);
};

const shelfMutedTone = {
	label: "text-muted-foreground",
	chevron: "text-muted-foreground",
} as const;

const shelfHeaderTones = {
	attention: {
		label: "text-amber-600 dark:text-amber-400",
		chevron: "text-amber-600 dark:text-amber-400",
	},
	active: shelfMutedTone,
	settled: shelfMutedTone,
	workspace: shelfMutedTone,
	pinned: shelfMutedTone,
	updated: shelfMutedTone,
} as const;

const SessionShelfHeader: FC<{
	tone: SessionListSection["tone"];
	label: string;
	workspace?: Workspace | undefined;
	onCreateChatInWorkspace: (workspaceId: string) => void;
	expanded: boolean;
	onToggle: () => void;
}> = ({ tone, label, workspace, onCreateChatInWorkspace, expanded, onToggle }) => {
	const classes = shelfHeaderTones[tone];
	const glyph = workspaceGlyphColor(workspace?.color);
	const qaId =
		tone === "workspace" ? "session-list-workspace-toggle" : `session-list-${tone}-toggle`;
	return (
		<div
			className={cn(
				"flex items-center",
				tone === "workspace" &&
					"group/workspace-row rounded-md transition-colors hover:bg-foreground/5 focus-within:bg-foreground/5",
			)}
			data-slot={`aui_session-list-${tone}-header`}
		>
			<Button
				type="button"
				variant="ghost"
				onClick={onToggle}
				aria-expanded={expanded}
				data-qa-id={qaId}
				className={cn(
					"group/shelf h-7 min-w-0 flex-1 justify-start gap-2 bg-transparent px-2 font-normal hover:bg-transparent aria-expanded:bg-transparent",
					sidebarNavRadiusClassName,
				)}
			>
				{tone === "workspace" ? (
					<FolderIcon
						aria-hidden
						data-slot="aui_session-list-workspace-icon"
						className="size-3.5 shrink-0"
						{...(glyph ? { color: glyph } : {})}
					/>
				) : null}
				<span
					className={cn(
						"min-w-0 truncate font-medium",
						tone === "pinned" ? "text-sm" : "text-[13px]",
						classes.label,
					)}
				>
					{label}
				</span>
				<ChevronDownIcon
					aria-hidden
					className={cn(
						"size-3 opacity-0 transition-[opacity,transform] group-hover/shelf:opacity-100 group-focus-visible/shelf:opacity-100 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100",
						classes.chevron,
						!expanded && "-rotate-90",
					)}
				/>
			</Button>
			{tone === "workspace" && workspace ? (
				<WorkspaceShelfActions
					workspace={workspace}
					onCreateChatInWorkspace={onCreateChatInWorkspace}
				/>
			) : null}
		</div>
	);
};

const WorkspaceShelfActions: FC<{
	workspace: Workspace;
	onCreateChatInWorkspace: (workspaceId: string) => void;
}> = ({ workspace, onCreateChatInWorkspace }) => {
	const { openEdit, openDelete } = useWorkspacesFeature();

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
											className="text-muted-foreground size-5"
										/>
									}
								/>
							}
						>
							<MoreHorizontalIcon aria-hidden className="size-3.5" />
						</TooltipTrigger>
						<TooltipContent side="bottom">More</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" side="right" sideOffset={6}>
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
								aria-label={`New chat in ${workspace.name}`}
								data-qa-id={`session-list-workspace-new-${workspace.id}`}
								className="text-muted-foreground size-5"
								onClick={() => onCreateChatInWorkspace(workspace.id)}
							/>
						}
					>
						<PlusIcon aria-hidden className="size-3.5" />
					</TooltipTrigger>
					<TooltipContent side="bottom">New chat</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	);
};

const rowStateLabels: Record<
	Exclude<SessionRowState, null>,
	{ label: string; className: string }
> = {
	approval: { label: "Requires Approval", className: "text-amber-600 dark:text-amber-400" },
	input: { label: "Requires Input", className: "text-amber-600 dark:text-amber-400" },
	working: { label: "Working", className: "text-sky-600 dark:text-sky-400" },
	done: { label: "Done", className: "text-green-800 dark:text-green-400" },
};

/** One shared interval per tick rate so every row doesn't open its own timer. */
const nowListeners = new Map<number, Set<(now: number) => void>>();
const nowIntervals = new Map<number, ReturnType<typeof setInterval>>();

function subscribeSharedNow(intervalMs: number, listener: (now: number) => void): () => void {
	let listeners = nowListeners.get(intervalMs);
	if (!listeners) {
		listeners = new Set();
		nowListeners.set(intervalMs, listeners);
		nowIntervals.set(
			intervalMs,
			setInterval(() => {
				const now = Date.now();
				for (const notify of listeners!) notify(now);
			}, intervalMs),
		);
	}
	listeners.add(listener);
	return () => {
		listeners!.delete(listener);
		if (listeners!.size > 0) return;
		clearInterval(nowIntervals.get(intervalMs)!);
		nowListeners.delete(intervalMs);
		nowIntervals.delete(intervalMs);
	};
}

function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => subscribeSharedNow(intervalMs, setNow), [intervalMs]);
	return now;
}

const SessionRelativeTime: FC<{ timestamp: number }> = ({ timestamp }) => {
	const now = useNow(30_000);
	return <>{formatRelativeTimeLabel(timestamp, now)}</>;
};

const WorkingTooltipLabel: FC<{ label: string; startedAt: number }> = ({ label, startedAt }) => {
	const now = useNow(1_000);
	return (
		<>
			{label} · {formatWorkingDurationLabel(now - startedAt)}
		</>
	);
};

const SessionRowGlyph: FC<{
	rowState: SessionRowState;
	isActive: boolean;
	workingSince: number | undefined;
}> = ({ rowState, isActive, workingSince }) => {
	if (rowState === null) return null;
	const { label, className } = rowStateLabels[rowState];
	return (
		<TooltipProvider delay={300}>
			<Tooltip>
				<TooltipTrigger
					render={
						<span
							role="status"
							aria-label={label}
							className={cn(
								"inline-flex size-3.5 shrink-0 items-center justify-center",
								rowState !== "done" && className,
								rowState === "working" && !isActive && "opacity-75",
							)}
						/>
					}
				>
					{rowState === "working" ? (
						<Loader2Icon aria-hidden className="size-3.5 animate-spin" />
					) : null}
					{rowState === "done" ? (
						<span
							data-qa-id="session-list-done-dot"
							aria-hidden
							className="bg-muted-foreground/40 size-1.5 rounded-full"
						/>
					) : null}
					{rowState === "approval" ? <CircleAlertIcon aria-hidden className="size-3.5" /> : null}
					{rowState === "input" ? (
						<MessageCircleQuestionIcon aria-hidden className="size-3.5" />
					) : null}
				</TooltipTrigger>
				<TooltipContent side="right">
					{rowState === "working" && workingSince !== undefined ? (
						<WorkingTooltipLabel label={label} startedAt={workingSince} />
					) : (
						label
					)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

const RowHoverAction: FC<{
	label: string;
	tooltip: string;
	slot: string;
	onClick: () => void;
	children: ReactNode;
}> = ({ label, tooltip, slot, onClick, children }) => (
	<Tooltip>
		<TooltipTrigger
			render={
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-5"
					aria-label={label}
					data-slot={slot}
					onClick={onClick}
				/>
			}
		>
			{children}
		</TooltipTrigger>
		<TooltipContent side="bottom">{tooltip}</TooltipContent>
	</Tooltip>
);

function useRenameState(): {
	isRenaming: boolean;
	startRename: () => void;
	finishRename: (restoreFocus: boolean) => void;
	triggerRef: React.RefObject<HTMLButtonElement | null>;
} {
	const [isRenaming, setIsRenaming] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const restoreFocusRef = useRef(false);

	useEffect(() => {
		if (isRenaming || !restoreFocusRef.current) return;
		restoreFocusRef.current = false;
		triggerRef.current?.focus();
	}, [isRenaming]);
	const startRename = useCallback(() => setIsRenaming(true), []);
	const finishRename = useCallback((restoreFocus: boolean) => {
		restoreFocusRef.current = restoreFocus;
		setIsRenaming(false);
	}, []);

	return {
		isRenaming,
		startRename,
		finishRename,
		triggerRef,
	};
}

const SessionRow: FC = () => {
	const aui = useAui();
	const auiRef = useRef(aui);
	auiRef.current = aui;
	const navigate = useNavigateToChat();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const threadId = useAuiState((s) => s.threadListItem.id);
	const itemStatus = useAuiState((s) => s.threadListItem.status);
	const isActive = useAuiState((s) => s.threadListItem.id === s.threads.mainThreadId);
	const activity = useSessionActivity((s) => (remoteId ? s.sessions[remoteId] : undefined));
	const lastVisitedAt = useSessionActivity((s) =>
		remoteId ? s.lastVisitedAtBySessionId[remoteId] : undefined,
	);
	const { workspaces } = useWorkspacesFeature();
	const { show, pinnedIds, togglePin } = use(SessionListChromeContext);
	const indented = use(SessionRowIndentContext);
	const { isRenaming, startRename, finishRename, triggerRef } = useRenameState();
	const switchToSettled = useCallback(() => {
		void auiRef.current.threadListItem.switchTo({ unarchive: false });
	}, []);
	const archive = useCallback(() => {
		void auiRef.current.threadListItem.archive();
	}, []);
	const unarchive = useCallback(() => {
		void auiRef.current.threadListItem.unarchive();
	}, []);
	const deleteThread = useCallback(() => {
		void auiRef.current.threadListItem.delete();
	}, []);

	return (
		<SessionRowContent
			remoteId={remoteId}
			threadId={threadId}
			itemStatus={itemStatus}
			isActive={isActive}
			activity={activity}
			lastVisitedAt={lastVisitedAt}
			workspaces={workspaces}
			show={show}
			pinnedIds={pinnedIds}
			togglePin={togglePin}
			indented={indented}
			isRenaming={isRenaming}
			startRename={startRename}
			finishRename={finishRename}
			triggerRef={triggerRef}
			navigate={navigate}
			switchToSettled={switchToSettled}
			archive={archive}
			unarchive={unarchive}
			deleteThread={deleteThread}
		/>
	);
};

type SessionRowContentProps = {
	remoteId: string | undefined;
	threadId: string;
	itemStatus: ThreadListItemStatus;
	isActive: boolean;
	activity: SessionActivity | undefined;
	lastVisitedAt: number | undefined;
	workspaces: readonly Workspace[];
	show: readonly SessionListShowField[];
	pinnedIds: ReadonlySet<string>;
	togglePin: (id: string) => void;
	indented: boolean;
	isRenaming: boolean;
	startRename: () => void;
	finishRename: (restoreFocus: boolean) => void;
	triggerRef: React.RefObject<HTMLButtonElement | null>;
	navigate: () => void;
	switchToSettled: () => void;
	archive: () => void;
	unarchive: () => void;
	deleteThread: () => void;
};

const SessionRowContent = memo(function SessionRowContent({
	remoteId,
	threadId,
	itemStatus,
	isActive,
	activity,
	lastVisitedAt,
	workspaces,
	show,
	pinnedIds,
	togglePin,
	indented,
	isRenaming,
	startRename,
	finishRename,
	triggerRef,
	navigate,
	switchToSettled,
	archive,
	unarchive,
	deleteThread,
}: SessionRowContentProps) {
	const rowState = deriveSessionRowState(activity, lastVisitedAt);
	const isSettled = itemStatus === "archived" && rowState !== "approval" && rowState !== "input";
	const canSettle = !isSettled && (rowState === null || rowState === "done");
	const pinId = remoteId ?? threadId;
	const isPinned = pinnedIds.has(pinId);
	const locationLabel = resolveSessionLocationLabel(activity, workspaces);
	const workspace = activity?.workspaceId
		? workspaces.find((candidate) => candidate.id === activity.workspaceId)
		: undefined;
	const workspaceColor = workspaceGlyphColor(workspace?.color);
	const showUpdated = show.includes("updated");
	const showWorkspace = show.includes("workspace") && locationLabel !== null;
	const updatedAt = showUpdated ? activity?.updatedAt : undefined;

	const leadingIcon = isSettled ? (
		<TooltipProvider delay={300}>
			<Tooltip>
				<TooltipTrigger
					render={
						<span
							role="status"
							aria-label="Settled"
							className={cn(
								"inline-flex size-3.5 shrink-0 items-center justify-center transition-opacity",
								!isActive &&
									"opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
							)}
						/>
					}
				>
					<CheckIcon aria-hidden className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent side="right">Settled</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	) : rowState !== null ? (
		<SessionRowGlyph
			rowState={rowState}
			isActive={isActive}
			workingSince={activity?.workingSince}
		/>
	) : (
		<span className="inline-flex size-3.5 shrink-0" aria-hidden />
	);

	const rightSlot = updatedAt !== undefined ? <SessionRelativeTime timestamp={updatedAt} /> : null;

	const glyph = indented ? (
		<span className="flex h-7 w-4 shrink-0 items-center justify-center">{leadingIcon}</span>
	) : (
		leadingIcon
	);

	const titleRow = (
		<span className={cn("flex h-7 min-w-0 items-center", indented ? "gap-1.5" : glyph && "gap-2")}>
			{glyph}
			<span
				data-slot="aui_session-list-item-title"
				className={cn(
					"min-w-0 flex-1 truncate text-[13px]",
					// sidebar-accent-foreground is a muted storm step for filled
					// accent chips; titles sit on a faint wash, so hover/selected
					// use full sidebar-foreground.
					isSettled && !isActive
						? "text-muted-foreground group-hover/sidebar-row:text-sidebar-foreground"
						: isActive
							? "text-sidebar-foreground"
							: "text-sidebar-foreground/70 group-hover/sidebar-row:text-sidebar-foreground",
				)}
			>
				<ThreadListItemPrimitive.Title fallback="New Chat" />
			</span>
			<span
				data-slot="aui_session-list-item-time"
				className={cn(
					"ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end gap-1 tabular-nums text-xs text-muted-foreground transition-opacity",
					canSettle || isSettled
						? "group-hover/sidebar-row:min-w-24 group-has-[:focus-visible]/sidebar-row:min-w-24 group-has-[[data-popup-open]]/sidebar-row:min-w-24"
						: "group-hover/sidebar-row:min-w-16 group-has-[:focus-visible]/sidebar-row:min-w-16 group-has-[[data-popup-open]]/sidebar-row:min-w-16",
					rightSlot ? rowHoverLabelFadeClassName : null,
				)}
			>
				{rightSlot}
			</span>
		</span>
	);

	const infoLine =
		showWorkspace && locationLabel ? (
			<span
				data-slot="aui_session-list-item-info"
				className={cn(
					"text-muted-foreground flex min-w-0 items-center gap-1.5 truncate pb-1 text-xs",
					indented && "ml-1.5 pl-4",
				)}
			>
				<FolderIcon
					aria-hidden
					data-slot="aui_session-list-workspace-icon"
					className="size-3.5 shrink-0"
					{...(workspaceColor ? { color: workspaceColor } : {})}
				/>
				<span className="truncate">{locationLabel}</span>
			</span>
		) : null;

	const rowPad = indented ? "pl-2 pr-2.5" : "px-2.5";

	return (
		<ThreadListItemPrimitive.Root
			data-slot={isSettled ? "aui_session-list-settled-item" : "aui_session-list-item"}
			className={cn(
				"group/sidebar-row relative w-full cursor-pointer rounded-md text-left outline-none select-none",
				isActive ? sidebarSurfaceActiveClassName : sidebarSurfaceIdleClassName,
			)}
		>
			{isRenaming ? (
				<div className={cn("flex h-7 items-center", rowPad)}>
					<SessionItemRename onDone={finishRename} />
				</div>
			) : isSettled ? (
				<button
					ref={triggerRef}
					type="button"
					data-slot="aui_session-list-settled-trigger"
					data-sidebar-select
					className={cn("flex w-full flex-col py-0 text-left focus-visible:outline-none", rowPad)}
					onClick={() => {
						navigate();
						switchToSettled();
					}}
				>
					{titleRow}
					{infoLine}
				</button>
			) : (
				<ThreadListItemPrimitive.Trigger
					ref={triggerRef}
					onClick={navigate}
					data-slot="aui_session-list-item-trigger"
					data-sidebar-select
					className={cn("flex w-full flex-col py-0 text-left focus-visible:outline-none", rowPad)}
				>
					{titleRow}
					{infoLine}
				</ThreadListItemPrimitive.Trigger>
			)}
			{!isRenaming && (
				<span className={cn(rowHoverActionsClassName, "right-1.5 top-0 h-7")}>
					<TooltipProvider>
						{canSettle ? (
							<RowHoverAction
								label="Settle thread"
								tooltip="Settle"
								slot="aui_session-list-item-settle"
								onClick={archive}
							>
								<CheckIcon aria-hidden />
							</RowHoverAction>
						) : null}
						{isSettled ? (
							<RowHoverAction
								label="Un-settle thread"
								tooltip="Un-settle"
								slot="aui_session-list-item-unsettle"
								onClick={unarchive}
							>
								<Undo2Icon aria-hidden />
							</RowHoverAction>
						) : null}
						<RowHoverAction
							label={isPinned ? "Unpin thread" : "Pin thread"}
							tooltip={isPinned ? "Unpin" : "Pin"}
							slot="aui_session-list-item-pin"
							onClick={() => togglePin(pinId)}
						>
							{isPinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
						</RowHoverAction>
						<SessionRowMenu
							settleAction={isSettled ? "unsettle" : canSettle ? "settle" : undefined}
							pinned={isPinned}
							onPin={() => togglePin(pinId)}
							onRename={startRename}
							onSettle={archive}
							onUnsettle={unarchive}
							onDelete={deleteThread}
						/>
					</TooltipProvider>
				</span>
			)}
		</ThreadListItemPrimitive.Root>
	);
});

const SessionRowMenu: FC<{
	settleAction?: "settle" | "unsettle" | undefined;
	pinned: boolean;
	onPin: () => void;
	onRename: () => void;
	onSettle: () => void;
	onUnsettle: () => void;
	onDelete: () => void;
}> = ({ settleAction, pinned, onPin, onRename, onSettle, onUnsettle, onDelete }) => {
	return (
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
									className="size-5"
									data-slot="aui_session-list-item-more"
									aria-label="Thread actions"
								/>
							}
						/>
					}
				>
					<MoreHorizontalIcon />
				</TooltipTrigger>
				<TooltipContent side="bottom">More</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" side="right" sideOffset={6}>
				<DropdownMenuItem onClick={onPin}>
					{pinned ? <PinOffIcon /> : <PinIcon />}
					{pinned ? "Unpin" : "Pin"}
				</DropdownMenuItem>
				{settleAction === "settle" && (
					<DropdownMenuItem onClick={onSettle}>
						<CheckIcon />
						Settle
					</DropdownMenuItem>
				)}
				{settleAction === "unsettle" && (
					<DropdownMenuItem onClick={onUnsettle}>
						<Undo2Icon />
						Un-settle
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" onClick={onDelete}>
					<Trash2Icon />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

const SessionItemRename: FC<{
	onDone: (restoreFocus: boolean) => void;
}> = ({ onDone }) => {
	const aui = useAui();
	const title = useAuiState((s) => s.threadListItem.title) ?? "";
	const [value, setValue] = useState(title);
	const inputRef = useRef<HTMLInputElement>(null);
	const settledRef = useRef(false);

	useEffect(() => {
		inputRef.current?.select();
	}, []);

	const commit = (restoreFocus: boolean) => {
		if (settledRef.current) return;
		settledRef.current = true;

		const next = value.trim();
		if (!next || next === title) {
			onDone(restoreFocus);
			return;
		}

		// Deferred so a synchronous throw lands on the rejection path too.
		Promise.resolve()
			.then(() => aui.threadListItem.rename(next))
			.then(
				() => onDone(restoreFocus),
				() => {
					settledRef.current = false;
					if (restoreFocus) inputRef.current?.focus();
				},
			);
	};

	const cancel = () => {
		if (settledRef.current) return;
		settledRef.current = true;
		onDone(true);
	};

	return (
		<Input
			ref={inputRef}
			autoFocus
			data-slot="aui_session-list-item-rename"
			aria-label="Rename thread"
			value={value}
			className="h-7 min-w-0 flex-1 px-1 text-[13px]"
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => commit(false)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					commit(true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					cancel();
				}
			}}
		/>
	);
};
