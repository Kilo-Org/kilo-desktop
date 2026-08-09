"use client";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import {
	AuiIf,
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronDownIcon,
	CircleCheckIcon,
	FolderIcon,
	Loader2Icon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	Trash2Icon,
	Undo2Icon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type FC,
} from "react";

import { useWorkspacesFeature } from "../../../workspaces/WorkspacesFeatureContext.js";
import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import {
	deriveSessionRowState,
	formatRelativeTimeLabel,
	formatWorkingDurationLabel,
	partitionSidebarThreads,
	resolveSessionLocationLabel,
	type SessionRowState,
} from "../../session-activity/session-activity-logic.js";

/** Match SidebarMenuButton / plugin nav item chrome in the app shell sidebar. */
const sidebarNavItemClassName =
	"text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground has-focus-visible:bg-sidebar-accent has-data-[state=open]:bg-sidebar-accent rounded-md transition-colors";

/** Override Button/Input `rounded-lg` so radius matches sidebar menu items. */
const sidebarNavRadiusClassName = "rounded-md!";

/**
 * Hover actions sit over the status slot: hidden until row hover, keyboard
 * focus, or an open dropdown, then cross-fade with the status label (which
 * fades out via the matching group classes on the label itself).
 */
const rowHoverActionsClassName =
	"pointer-events-none absolute flex items-center gap-0.5 opacity-0 transition-opacity group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

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
	layout: true,
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	exit: { opacity: 0 },
	transition: { duration: 0.15 },
};

export const SessionList: FC = () => {
	const [search, setSearch] = useState("");
	const hasThreads = useAuiState(
		(s) => s.threads.threadIds.length > 0 || s.threads.archivedThreadIds.length > 0,
	);

	return (
		<div data-qa-id="kilo-thread-list">
			<SessionListRoot>
				<SessionListNewChat />
				{hasThreads && <SessionListSearch value={search} onValueChange={setSearch} />}
				<SessionListItems searchQuery={hasThreads ? search : ""} />
			</SessionListRoot>
		</div>
	);
};

const SessionListRoot: FC<ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>> = ({
	className,
	...props
}) => {
	return (
		<ThreadListPrimitive.Root
			data-slot="aui_thread-list-root"
			className={cn("flex flex-col gap-0.5", className)}
			{...props}
		/>
	);
};

const SessionListNewChat: FC<
	ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
> = ({ className, labelClassName, children, ...props }) => {
	return (
		<ThreadListPrimitive.New
			render={
				<Button
					variant="ghost"
					data-slot="aui_thread-list-new"
					className={cn(
						"h-8 w-full justify-start gap-2 p-2 text-sm font-normal data-active:font-medium [&_svg]:size-4 [&_svg]:shrink-0",
						sidebarNavItemClassName,
						sidebarNavRadiusClassName,
						className,
					)}
					{...props}
				/>
			}
		>
			{children ?? (
				<>
					<PlusIcon data-slot="aui_thread-list-new-icon" />
					<span data-slot="aui_thread-list-new-label" className={cn("truncate", labelClassName)}>
						New Chat
					</span>
				</>
			)}
		</ThreadListPrimitive.New>
	);
};

const SessionListSearch: FC<
	Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
		value: string;
		onValueChange: (value: string) => void;
	}
> = ({ className, value, onValueChange, ...props }) => {
	return (
		<div data-slot="aui_thread-list-search" className="relative py-1">
			<SearchIcon
				data-slot="aui_thread-list-search-icon"
				className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2"
			/>
			<Input
				type="search"
				value={value}
				onChange={(event) => onValueChange(event.target.value)}
				aria-label="Search threads"
				placeholder="Search threads"
				className={cn(
					"bg-sidebar-accent text-sidebar-accent-foreground h-8 w-full border-0 ps-8 text-sm shadow-none dark:bg-sidebar-accent focus-visible:border-0 focus-visible:ring-0",
					sidebarNavRadiusClassName,
					className,
				)}
				{...props}
			/>
		</div>
	);
};

const SessionListItems: FC<{ searchQuery?: string }> = ({ searchQuery = "" }) => {
	return (
		<div data-slot="aui_thread-list-items" className="flex flex-col gap-0.5">
			<AuiIf condition={(s) => s.threads.isLoading}>
				<SessionListSkeleton />
			</AuiIf>
			<AuiIf condition={(s) => !s.threads.isLoading}>
				<SessionListSections searchQuery={searchQuery} />
			</AuiIf>
		</div>
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

const SessionListSections: FC<{ searchQuery: string }> = ({ searchQuery }) => {
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const activityBySessionId = useSessionActivity((s) => s.sessions);
	const [attentionExpanded, setAttentionExpanded] = useState(true);
	const [activeExpanded, setActiveExpanded] = useState(true);
	const [settledExpanded, setSettledExpanded] = useState(true);

	const query = searchQuery.trim().toLowerCase();

	const partition = useMemo(() => {
		const itemsById = new Map(threadItems.map((item) => [item.id, item]));
		const toEntry = (id: string) => {
			const item = itemsById.get(id);
			return { id, remoteId: item?.remoteId, title: item?.title };
		};
		const matchesQuery = (entry: { title?: string | undefined }) =>
			!query || (entry.title || "New Chat").toLowerCase().includes(query);
		return partitionSidebarThreads({
			regular: threadIds.map(toEntry).filter(matchesQuery),
			archived: archivedThreadIds.map(toEntry).filter(matchesQuery),
			activityBySessionId,
		});
	}, [activityBySessionId, archivedThreadIds, query, threadIds, threadItems]);

	const isEmpty =
		partition.attention.length === 0 &&
		partition.sessions.length === 0 &&
		partition.settled.length === 0;

	if (query && isEmpty) {
		return (
			<div data-slot="aui_thread-list-empty" className="text-muted-foreground px-2.5 py-4 text-sm">
				No threads found
			</div>
		);
	}

	if (isEmpty) return null;

	return (
		<ul role="list" className="relative flex flex-col gap-px">
			<AnimatePresence initial={false} mode="popLayout">
				{partition.attention.length > 0 && (
					<SessionShelfHeader
						key="attention-header"
						tone="attention"
						label="Needs Attention"
						count={partition.attention.length}
						alwaysShowCount
						expanded={attentionExpanded}
						onToggle={() => setAttentionExpanded((value) => !value)}
					/>
				)}
				{attentionExpanded &&
					partition.attention.map(({ index, archived }) => (
						<motion.li
							{...rowMotionProps}
							key={(archived ? archivedThreadIds : threadIds)[index] ?? `attention-${index}`}
							className="list-none [contain-intrinsic-size:auto_64px] [content-visibility:auto]"
						>
							<ThreadListPrimitive.ItemByIndex
								index={index}
								archived={archived}
								components={{ ThreadListItem: SessionCardRow }}
							/>
						</motion.li>
					))}
				{partition.sessions.length > 0 && (
					<SessionShelfHeader
						key="active-header"
						tone="active"
						label="Active"
						count={partition.sessions.length}
						expanded={activeExpanded}
						onToggle={() => setActiveExpanded((value) => !value)}
					/>
				)}
				{activeExpanded &&
					partition.sessions.map((index) => (
						<motion.li
							{...rowMotionProps}
							key={threadIds[index] ?? `session-${index}`}
							className="list-none [contain-intrinsic-size:auto_64px] [content-visibility:auto]"
						>
							<ThreadListPrimitive.ItemByIndex
								index={index}
								components={{ ThreadListItem: SessionCardRow }}
							/>
						</motion.li>
					))}
				{partition.settled.length > 0 && (
					<SessionShelfHeader
						key="settled-header"
						tone="settled"
						label="Settled"
						count={partition.settled.length}
						expanded={settledExpanded}
						onToggle={() => setSettledExpanded((value) => !value)}
					/>
				)}
				{settledExpanded &&
					partition.settled.map((index) => (
						<motion.li
							{...rowMotionProps}
							key={archivedThreadIds[index] ?? `settled-${index}`}
							className="list-none [contain-intrinsic-size:auto_28px] [content-visibility:auto]"
						>
							<ThreadListPrimitive.ItemByIndex
								index={index}
								archived
								components={{ ThreadListItem: SettledSessionRow }}
							/>
						</motion.li>
					))}
			</AnimatePresence>
		</ul>
	);
};

const shelfHeaderTones = {
	attention: {
		label: "text-amber-600 dark:text-amber-400",
		chevron: "text-amber-600 dark:text-amber-400",
	},
	active: {
		label: "text-muted-foreground/70",
		chevron: "text-muted-foreground/70",
	},
	settled: {
		label: "text-muted-foreground/70",
		chevron: "text-muted-foreground/70",
	},
} as const;

const SessionShelfHeader: FC<{
	tone: keyof typeof shelfHeaderTones;
	label: string;
	count: number;
	alwaysShowCount?: boolean;
	expanded: boolean;
	onToggle: () => void;
}> = ({ tone, label, count, alwaysShowCount = false, expanded, onToggle }) => {
	const classes = shelfHeaderTones[tone];
	return (
		<motion.li
			{...rowMotionProps}
			className="list-none"
			data-slot={`aui_session-list-${tone}-header`}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				data-qa-id={`session-list-${tone}-toggle`}
				className="mt-3 mb-1 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
			>
				<span className={cn("text-xs font-medium", classes.label)}>
					{expanded && !alwaysShowCount ? label : `${label} (${count})`}
				</span>
				<span className="h-px flex-1" />
				<ChevronDownIcon
					aria-hidden
					className={cn("size-3 transition-transform", classes.chevron, !expanded && "rotate-180")}
				/>
			</button>
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

function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(interval);
	}, [intervalMs]);
	return now;
}

const WorkingDuration: FC<{ startedAt: number }> = ({ startedAt }) => {
	const now = useNow(1_000);
	return <>{formatWorkingDurationLabel(now - startedAt)}</>;
};

const SessionRelativeTime: FC<{ timestamp: number }> = ({ timestamp }) => {
	const now = useNow(30_000);
	return <>{formatRelativeTimeLabel(timestamp, now)}</>;
};

const SessionRowStatus: FC<{
	rowState: SessionRowState;
	workingSince: number | undefined;
	updatedAt: number | undefined;
	isActive: boolean;
}> = ({ rowState, workingSince, updatedAt, isActive }) => {
	if (rowState === null) {
		return updatedAt !== undefined ? <SessionRelativeTime timestamp={updatedAt} /> : null;
	}
	const { label, className } = rowStateLabels[rowState];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 font-medium",
				className,
				rowState === "working" && !isActive && "opacity-75",
			)}
		>
			{rowState === "working" ? (
				<Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin" />
			) : null}
			{rowState === "done" ? <CircleCheckIcon aria-hidden className="size-4 shrink-0" /> : null}
			{/* The label alone is the live region: wrapping the ticking duration
			    would make screen readers announce every second. */}
			<span role="status">{label}</span>
			{rowState === "working" && workingSince !== undefined ? (
				<span aria-hidden className="opacity-60">
					<WorkingDuration startedAt={workingSince} />
				</span>
			) : null}
		</span>
	);
};

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

const SessionCardRow: FC = () => {
	const aui = useAui();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const isRunning = useAuiState((s) => s.threadListItem.isRunning);
	const isActive = useAuiState((s) => s.threadListItem.id === s.threads.mainThreadId);
	const activity = useSessionActivity((s) => (remoteId ? s.sessions[remoteId] : undefined));
	const lastVisitedAt = useSessionActivity((s) =>
		remoteId ? s.lastVisitedAtBySessionId[remoteId] : undefined,
	);
	const { workspaces } = useWorkspacesFeature();
	const { isRenaming, startRename, finishRename, triggerRef } = useRenameState();

	const rowState = deriveSessionRowState(activity, lastVisitedAt) ?? (isRunning ? "working" : null);
	const canSettle = rowState === null || rowState === "done";
	const locationLabel = resolveSessionLocationLabel(activity, workspaces);

	return (
		<ThreadListItemPrimitive.Root
			data-slot="aui_session-list-item"
			className={cn(
				"group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
				isActive
					? "bg-sidebar-accent text-sidebar-foreground font-medium"
					: "bg-transparent text-sidebar-foreground hover:bg-sidebar-accent/60",
			)}
		>
			{isRenaming ? (
				<div className="px-2.5 py-2">
					<div className="flex h-5 min-w-0 items-center gap-1.5">
						<FolderIcon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
						<span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
							{locationLabel}
						</span>
					</div>
					<div className="mt-1 flex min-w-0">
						<SessionItemRename onDone={finishRename} />
					</div>
				</div>
			) : (
				<ThreadListItemPrimitive.Trigger
					ref={triggerRef}
					data-slot="aui_session-list-item-trigger"
					className="block w-full px-2.5 py-2 text-left focus-visible:outline-none"
				>
					<span className="flex h-5 min-w-0 items-center gap-1.5">
						<FolderIcon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
						<span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
							{locationLabel}
						</span>
						<span
							className={cn(
								"ml-auto flex h-5 min-w-8 shrink-0 items-center justify-end tabular-nums text-xs text-muted-foreground transition-[opacity,min-width]",
								// Expand only while hover actions are visible so the location
								// label truncates under Settle instead of always reserving room.
								canSettle &&
									"group-hover/sidebar-row:min-w-24 group-has-[:focus-visible]/sidebar-row:min-w-24 group-has-[[data-popup-open]]/sidebar-row:min-w-24",
								rowHoverLabelFadeClassName,
							)}
						>
							<SessionRowStatus
								rowState={rowState}
								workingSince={activity?.workingSince}
								updatedAt={activity?.updatedAt}
								isActive={isActive}
							/>
						</span>
					</span>
					<span className="mt-1 flex min-w-0">
						<span
							data-slot="aui_session-list-item-title"
							className="min-w-0 flex-1 truncate text-sm font-medium"
						>
							<ThreadListItemPrimitive.Title fallback="New Chat" />
						</span>
					</span>
				</ThreadListItemPrimitive.Trigger>
			)}
			{!isRenaming && (
				<span className={cn(rowHoverActionsClassName, "right-1.5 top-2 h-5")}>
					{canSettle && (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							aria-label="Settle thread"
							data-slot="aui_session-list-item-settle"
							onClick={() => void aui.threadListItem.archive()}
						>
							<CheckIcon aria-hidden className="size-3.5" />
							Settle
						</Button>
					)}
					<SessionRowMenu settleAction={canSettle ? "settle" : undefined} onRename={startRename} />
				</span>
			)}
		</ThreadListItemPrimitive.Root>
	);
};

const SettledSessionRow: FC = () => {
	const aui = useAui();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const isActive = useAuiState((s) => s.threadListItem.id === s.threads.mainThreadId);
	const activity = useSessionActivity((s) => (remoteId ? s.sessions[remoteId] : undefined));
	const { isRenaming, startRename, finishRename, triggerRef } = useRenameState();

	return (
		<ThreadListItemPrimitive.Root
			data-slot="aui_session-list-settled-item"
			className={cn(
				"group/sidebar-row relative flex h-7 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none select-none",
				isActive
					? "bg-sidebar-accent text-sidebar-foreground font-medium"
					: "bg-transparent text-sidebar-foreground hover:bg-sidebar-accent/60",
			)}
		>
			{isRenaming ? (
				<SessionItemRename onDone={finishRename} />
			) : (
				// Prefer a plain button over ThreadListItemPrimitive.Trigger: the
				// primitive's switchTo auto-unarchives, which would yank settled
				// sessions back into Active just from viewing them.
				<button
					ref={triggerRef}
					type="button"
					data-slot="aui_session-list-settled-trigger"
					className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
					onClick={() => {
						void aui.threadListItem.switchTo({ unarchive: false });
					}}
				>
					<CheckIcon
						aria-hidden
						className={cn(
							"size-3.5 shrink-0 transition-opacity",
							!isActive &&
								"opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
						)}
					/>
					<span
						data-slot="aui_session-list-item-title"
						className="text-muted-foreground group-hover/sidebar-row:text-foreground min-w-0 flex-1 truncate text-sm"
					>
						<ThreadListItemPrimitive.Title fallback="New Chat" />
					</span>
					{activity?.updatedAt !== undefined && (
						<span
							data-slot="aui_session-list-item-time"
							className={cn(
								"ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end tabular-nums text-xs text-muted-foreground transition-opacity",
								rowHoverLabelFadeClassName,
							)}
						>
							<SessionRelativeTime timestamp={activity.updatedAt} />
						</span>
					)}
				</button>
			)}
			{!isRenaming && (
				<span className={cn(rowHoverActionsClassName, "right-1.5 top-1/2 h-6 -translate-y-1/2")}>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Un-settle thread"
						data-slot="aui_session-list-item-unsettle"
						onClick={() => void aui.threadListItem.unarchive()}
					>
						<Undo2Icon aria-hidden className="mb-px size-3.5" />
					</Button>
					<SessionRowMenu settleAction="unsettle" onRename={startRename} />
				</span>
			)}
		</ThreadListItemPrimitive.Root>
	);
};

const SessionRowMenu: FC<{
	settleAction?: "settle" | "unsettle" | undefined;
	onRename: () => void;
}> = ({ settleAction, onRename }) => {
	const aui = useAui();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						data-slot="aui_session-list-item-more"
						aria-label="Thread actions"
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="right" sideOffset={6}>
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
			className="h-7 min-w-0 flex-1 px-1 text-sm"
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
