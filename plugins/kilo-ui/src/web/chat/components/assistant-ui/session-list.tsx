"use client";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { SidebarGroupLabel, SidebarSearch } from "@anaconda-agentic-desktop/ui/components/sidebar";
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
} from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	Loader2Icon,
	MessageCircleQuestionIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	PlusIcon,
	Trash2Icon,
	Undo2Icon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	createContext,
	use,
	useEffect,
	useCallback,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type FC,
	type ReactNode,
} from "react";

import { useWorkspacesFeature } from "../../../workspaces/WorkspacesFeatureContext.js";
import { navigateToChat } from "../../chat-navigation.js";
import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import {
	deriveSessionRowState,
	formatRelativeTimeLabel,
	formatWorkingDurationLabel,
	resolveSessionLocationLabel,
	type SessionRowState,
} from "../../session-activity/session-activity-logic.js";
import { SessionListViewMenu } from "../../session-list/session-list-view-menu.js";
import {
	buildSessionListSections,
	SESSION_LIST_GROUPING_HEADERS,
	visibleShowFields,
	type SessionListSection,
	type SessionListShowField,
	type SessionListView,
} from "../../session-list/session-list-view.js";
import {
	useSessionListPins,
	useSessionListView,
} from "../../session-list/use-session-list-view.js";

/**
 * Shared glass surface states for New Chat, Search, and session rows.
 * Idle is clear; hover/focus and selected use the same translucent washes.
 */
const sidebarSurfaceIdleClassName =
	"bg-transparent text-sidebar-foreground transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5";
const sidebarSurfaceActiveClassName =
	"bg-foreground/8 text-sidebar-foreground font-medium transition-colors hover:bg-foreground/8 focus-visible:bg-foreground/8";

/** Soft glass chrome for sidebar buttons (New Chat). */
const sidebarNavItemClassName = cn(
	sidebarSurfaceIdleClassName,
	"rounded-md hover:text-sidebar-accent-foreground data-active:bg-foreground/8 data-active:text-sidebar-accent-foreground data-active:font-medium data-active:hover:bg-foreground/8 has-focus-visible:bg-foreground/5 has-data-[state=open]:bg-foreground/5",
);

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

/**
 * Row enter/exit/move transitions. `popLayout` pops exiting rows out of the
 * flow so siblings slide into place while the row fades.
 */
const rowMotionProps: Pick<
	ComponentPropsWithoutRef<typeof motion.li>,
	"layout" | "initial" | "animate" | "exit" | "transition"
> = {
	layout: "position",
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	exit: { opacity: 0 },
	transition: { duration: 0.15 },
};

const SessionListChromeContext = createContext<{
	show: readonly SessionListShowField[];
	pinnedIds: ReadonlySet<string>;
	togglePin: (id: string) => void;
}>({ show: [], pinnedIds: new Set(), togglePin: () => undefined });

const SessionRowIndentContext = createContext(false);

/**
 * Resolve ItemByIndex from a stable thread id. AnimatePresence keeps deleted
 * rows mounted during exit; index lookup would then hit a missing slot and
 * throw `useClientLookup: key "undefined" not found`. When the id is gone,
 * render nothing so the exit fade can finish without a lookup.
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

export const SessionList: FC = () => {
	const [search, setSearch] = useState("");
	const { view, update, reset } = useSessionListView();
	const { ids: pinIds, toggle: togglePin } = useSessionListPins();
	const pinnedIds = useMemo(() => new Set(pinIds), [pinIds]);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const isLoading = useAuiState((s) => s.threads.isLoading);
	const activityBySessionId = useSessionActivity((s) => s.sessions);
	const { workspaces } = useWorkspacesFeature();
	const show = visibleShowFields(view);
	const hasThreads = threadIds.length > 0 || archivedThreadIds.length > 0;
	const query = search.trim().toLowerCase();

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
		const matchesQuery = (title: string | undefined) =>
			!query || (title || "New Chat").toLowerCase().includes(query);
		const entries = [
			...threadIds.map((id, index) => toEntry(id, index, false)),
			...archivedThreadIds.map((id, index) => toEntry(id, index, true)),
		].filter((entry) => matchesQuery(entry.title));
		return buildSessionListSections({
			entries,
			activityBySessionId,
			workspaces,
			view,
			pinnedIds,
		});
	}, [
		activityBySessionId,
		archivedThreadIds,
		pinnedIds,
		query,
		threadIds,
		threadItems,
		view,
		workspaces,
	]);

	const pinnedSections = sections.filter((section) => section.tone === "pinned");
	const groupedSections = sections.filter((section) => section.tone !== "pinned");
	const collapsibleKeys = sections.flatMap((section) => (section.label ? [section.key] : []));
	const allCollapsed =
		collapsibleKeys.length > 0 && collapsibleKeys.every((key) => expanded[key] === false);

	return (
		<div data-qa-id="kilo-thread-list" className="flex min-h-0 flex-1 flex-col">
			<SessionListChromeContext value={{ show, pinnedIds, togglePin }}>
				<ThreadListPrimitive.Root
					data-slot="aui_thread-list-root"
					className="flex min-h-0 flex-1 flex-col gap-0.5"
				>
					<SessionListNewChat />
					{hasThreads ? <SessionListSearch value={search} onValueChange={setSearch} /> : null}
					<div
						data-slot="aui_thread-list-items"
						className="scroll-fade no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain"
					>
						{!isLoading && pinnedSections.length > 0 ? (
							<div className="mt-3">
								<SessionListSections
									sections={pinnedSections}
									expanded={expanded}
									onExpandedChange={setExpanded}
								/>
							</div>
						) : null}
						{hasThreads ? (
							<SessionListGroupingHeader
								view={view}
								onViewChange={update}
								onReset={reset}
								followsPinned={pinnedSections.length > 0}
								canCollapse={collapsibleKeys.length > 0}
								allCollapsed={allCollapsed}
								onCollapseAll={() => {
									setExpanded(Object.fromEntries(collapsibleKeys.map((key) => [key, false])));
								}}
								onExpandAll={() => {
									setExpanded(Object.fromEntries(collapsibleKeys.map((key) => [key, true])));
								}}
							/>
						) : null}
						{isLoading ? <SessionListSkeleton /> : null}
						{!isLoading && query && sections.length === 0 ? (
							<div
								data-slot="aui_thread-list-empty"
								className="text-muted-foreground px-2.5 py-4 text-sm"
							>
								No chats found
							</div>
						) : null}
						{!isLoading ? (
							<SessionListSections
								sections={groupedSections}
								expanded={expanded}
								onExpandedChange={setExpanded}
							/>
						) : null}
					</div>
				</ThreadListPrimitive.Root>
			</SessionListChromeContext>
		</div>
	);
};

function useNavigateToChat(): () => void {
	const sdk = useSdk("kilo-ui");
	return useCallback(() => navigateToChat(sdk), [sdk]);
}

const SessionListNewChat: FC = () => {
	const navigate = useNavigateToChat();
	return (
		<ThreadListPrimitive.New
			onClick={navigate}
			render={
				<Button
					variant="ghost"
					data-slot="aui_thread-list-new"
					className={cn(
						"h-8 w-full justify-start gap-2 p-2 text-sm font-normal data-active:font-medium [&_svg]:size-4 [&_svg]:shrink-0",
						sidebarNavItemClassName,
						sidebarNavRadiusClassName,
					)}
				/>
			}
		>
			<PlusIcon data-slot="aui_thread-list-new-icon" />
			<span data-slot="aui_thread-list-new-label" className="truncate">
				New Chat
			</span>
		</ThreadListPrimitive.New>
	);
};

const SessionListSearch: FC<{
	value: string;
	onValueChange: (value: string) => void;
}> = ({ value, onValueChange }) => {
	return (
		<SidebarSearch
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
			aria-label="Search chats"
			placeholder="Search chats"
		/>
	);
};

const SessionListGroupingHeader: FC<{
	view: SessionListView;
	onViewChange: (patch: Partial<SessionListView>) => void;
	onReset: () => void;
	followsPinned: boolean;
	canCollapse: boolean;
	allCollapsed: boolean;
	onCollapseAll: () => void;
	onExpandAll: () => void;
}> = ({
	view,
	onViewChange,
	onReset,
	followsPinned,
	canCollapse,
	allCollapsed,
	onCollapseAll,
	onExpandAll,
}) => {
	return (
		<SidebarGroupLabel
			data-qa-id="session-list-grouping-header"
			data-slot="aui_session-list-grouping-header"
			className={cn("text-muted-foreground/70 mb-0 h-7", followsPinned ? "mt-2" : "mt-3")}
		>
			<span className="min-w-0 flex-1 truncate text-sm font-medium">
				{SESSION_LIST_GROUPING_HEADERS[view.grouping]}
			</span>
			<SessionListViewMenu
				view={view}
				onViewChange={onViewChange}
				onReset={onReset}
				canCollapse={canCollapse}
				allCollapsed={allCollapsed}
				onCollapseAll={onCollapseAll}
				onExpandAll={onExpandAll}
			/>
		</SidebarGroupLabel>
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

const SessionListSections: FC<{
	sections: SessionListSection[];
	expanded: Record<string, boolean>;
	onExpandedChange: (value: Record<string, boolean>) => void;
}> = ({ sections, expanded, onExpandedChange }) => {
	if (sections.length === 0) return null;

	return (
		<ul role="list" className="relative flex flex-col gap-px">
			<AnimatePresence initial={false} mode="popLayout">
				{sections.flatMap((section, index) => {
					const isExpanded = !section.label || expanded[section.key] !== false;
					const header = section.label ? (
						<SessionShelfHeader
							key={`${section.key}-header`}
							tone={section.tone}
							label={section.label}
							expanded={isExpanded}
							spaced={sections.slice(0, index).some((entry) => entry.label)}
							onToggle={() => onExpandedChange({ ...expanded, [section.key]: !isExpanded })}
						/>
					) : null;
					const rows = isExpanded
						? section.rows.map((row) => (
								<motion.li {...rowMotionProps} key={row.id} className="list-none">
									<SessionRowIndentContext value={Boolean(section.label)}>
										<SessionListItemSlot id={row.id} archived={row.archived} />
									</SessionRowIndentContext>
								</motion.li>
							))
						: [];
					return header ? [header, ...rows] : rows;
				})}
			</AnimatePresence>
		</ul>
	);
};

const shelfMutedTone = {
	label: "text-muted-foreground/70",
	chevron: "text-muted-foreground/70",
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
	expanded: boolean;
	spaced?: boolean;
	onToggle: () => void;
}> = ({ tone, label, expanded, spaced = false, onToggle }) => {
	const classes = shelfHeaderTones[tone];
	const qaId =
		tone === "workspace" ? "session-list-workspace-toggle" : `session-list-${tone}-toggle`;
	return (
		<motion.li
			{...rowMotionProps}
			className="list-none"
			data-slot={`aui_session-list-${tone}-header`}
		>
			<Button
				type="button"
				variant="ghost"
				onClick={onToggle}
				aria-expanded={expanded}
				data-qa-id={qaId}
				className={cn(
					"group/shelf h-7 w-full justify-start gap-2 bg-transparent px-2 font-normal hover:bg-transparent aria-expanded:bg-transparent",
					sidebarNavRadiusClassName,
					spaced && "mt-2",
				)}
			>
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
						"size-3 opacity-0 transition-[opacity,transform] group-hover/shelf:opacity-100 group-focus-visible/shelf:opacity-100",
						classes.chevron,
						!expanded && "-rotate-90",
					)}
				/>
			</Button>
		</motion.li>
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
								"inline-flex shrink-0 items-center",
								className,
								rowState === "working" && !isActive && "opacity-75",
							)}
						/>
					}
				>
					{rowState === "working" ? (
						<Loader2Icon aria-hidden className="size-3.5 animate-spin" />
					) : null}
					{rowState === "done" ? <CircleCheckIcon aria-hidden className="size-3.5" /> : null}
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

	return {
		isRenaming,
		startRename: () => setIsRenaming(true),
		finishRename: (restoreFocus) => {
			restoreFocusRef.current = restoreFocus;
			setIsRenaming(false);
		},
		triggerRef,
	};
}

const SessionRow: FC = () => {
	const aui = useAui();
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

	const rowState = deriveSessionRowState(activity, lastVisitedAt);
	const isSettled = itemStatus === "archived" && rowState !== "approval" && rowState !== "input";
	const canSettle = !isSettled && (rowState === null || rowState === "done");
	const pinId = remoteId ?? threadId;
	const isPinned = pinnedIds.has(pinId);
	const locationLabel = resolveSessionLocationLabel(activity, workspaces);
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
								"inline-flex shrink-0 items-center transition-opacity",
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
	) : null;

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
					className={cn("flex w-full flex-col py-0 text-left focus-visible:outline-none", rowPad)}
					onClick={() => {
						navigate();
						void aui.threadListItem.switchTo({ unarchive: false });
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
					className={cn("flex w-full flex-col py-0 text-left focus-visible:outline-none", rowPad)}
				>
					{titleRow}
					{infoLine}
				</ThreadListItemPrimitive.Trigger>
			)}
			{!isRenaming && (
				<span className={cn(rowHoverActionsClassName, "right-1.5 top-1 h-6")}>
					<TooltipProvider>
						{canSettle ? (
							<RowHoverAction
								label="Settle thread"
								tooltip="Settle"
								slot="aui_session-list-item-settle"
								onClick={() => void aui.threadListItem.archive()}
							>
								<CheckIcon aria-hidden />
							</RowHoverAction>
						) : null}
						{isSettled ? (
							<RowHoverAction
								label="Un-settle thread"
								tooltip="Un-settle"
								slot="aui_session-list-item-unsettle"
								onClick={() => void aui.threadListItem.unarchive()}
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
						/>
					</TooltipProvider>
				</span>
			)}
		</ThreadListItemPrimitive.Root>
	);
};

const SessionRowMenu: FC<{
	settleAction?: "settle" | "unsettle" | undefined;
	pinned: boolean;
	onPin: () => void;
	onRename: () => void;
}> = ({ settleAction, pinned, onPin, onRename }) => {
	const aui = useAui();

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
					<DropdownMenuItem
						onClick={() => {
							void aui.threadListItem.archive();
						}}
					>
						<CheckIcon />
						Settle
					</DropdownMenuItem>
				)}
				{settleAction === "unsettle" && (
					<DropdownMenuItem
						onClick={() => {
							void aui.threadListItem.unarchive();
						}}
					>
						<Undo2Icon />
						Un-settle
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem
					variant="destructive"
					onClick={() => {
						void aui.threadListItem.delete();
					}}
				>
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
