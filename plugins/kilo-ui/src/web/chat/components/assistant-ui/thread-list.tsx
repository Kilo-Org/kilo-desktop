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
	ArchiveIcon,
	Loader2Icon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	Trash2Icon,
} from "lucide-react";
import {
	forwardRef,
	Fragment,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type FC,
} from "react";

/** Match SidebarMenuButton / plugin nav item chrome in the app shell sidebar. */
const sidebarNavItemClassName =
	"text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground has-focus-visible:bg-sidebar-accent has-data-[state=open]:bg-sidebar-accent rounded-md transition-colors";

/** Override Button/Input `rounded-lg` so radius matches sidebar menu items. */
const sidebarNavRadiusClassName = "rounded-md!";

export const ThreadList: FC = () => {
	const [search, setSearch] = useState("");
	const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);

	return (
		<div data-qa-id="kilo-thread-list">
			<ThreadListRoot>
				<ThreadListNew />
				{hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} />}
				<ThreadListItems searchQuery={hasThreads ? search : ""} />
			</ThreadListRoot>
		</div>
	);
};

export const ThreadListSearch = forwardRef<
	HTMLInputElement,
	Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
		value: string;
		onValueChange: (value: string) => void;
	}
>(({ className, value, onValueChange, ...props }, ref) => {
	return (
		<div data-slot="aui_thread-list-search" className="relative py-1">
			<SearchIcon
				data-slot="aui_thread-list-search-icon"
				className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2"
			/>
			<Input
				ref={ref}
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
});

ThreadListSearch.displayName = "ThreadListSearch";

export const ThreadListRoot: FC<ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>> = ({
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

export const ThreadListItems: FC<ComponentPropsWithoutRef<"div"> & { searchQuery?: string }> = ({
	className,
	searchQuery = "",
	...props
}) => {
	return (
		<div
			data-slot="aui_thread-list-items"
			className={cn("flex flex-col gap-0.5", className)}
			{...props}
		>
			<AuiIf condition={(s) => s.threads.isLoading}>
				<ThreadListSkeleton />
			</AuiIf>
			<AuiIf condition={(s) => !s.threads.isLoading}>
				<ThreadListItemGroups searchQuery={searchQuery} />
			</AuiIf>
		</div>
	);
};

const DAY_IN_MS = 86_400_000;

const dateGroupLabel = (date: Date | undefined, startOfToday: number): string => {
	if (!date || date.getTime() >= startOfToday) return "Today";
	if (date.getTime() >= startOfToday - DAY_IN_MS) return "Yesterday";
	return "Earlier";
};

type ThreadListGroup = { label: string; indices: number[] };

const ThreadListItemGroups: FC<{ searchQuery?: string }> = ({ searchQuery = "" }) => {
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);

	const query = searchQuery.trim().toLowerCase();

	const { filteredIndices, groups } = useMemo(() => {
		const itemsById = new Map(threadItems.map((item) => [item.id, item]));
		const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
		const filteredIndices = threadIds
			.map((id, index) => ({ id, index }))
			.filter(
				({ id }) =>
					!query || (itemsById.get(id)?.title || "New Chat").toLowerCase().includes(query),
			)
			.map(({ index }) => index);
		if (!filteredIndices.some((index) => dates[index])) {
			return { filteredIndices, groups: null };
		}

		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const time = (index: number) => dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
		const sorted = [...filteredIndices].sort((a, b) => time(b) - time(a));

		const result: ThreadListGroup[] = [];
		for (const index of sorted) {
			const label = dateGroupLabel(dates[index], startOfToday);
			const lastGroup = result[result.length - 1];
			if (lastGroup?.label === label) {
				lastGroup.indices.push(index);
			} else {
				result.push({ label, indices: [index] });
			}
		}
		return { filteredIndices, groups: result };
	}, [threadIds, threadItems, query]);

	if (query && filteredIndices.length === 0) {
		return (
			<div data-slot="aui_thread-list-empty" className="text-muted-foreground px-2.5 py-4 text-sm">
				No threads found
			</div>
		);
	}

	if (!groups) {
		return filteredIndices.map((index) => (
			<ThreadListPrimitive.ItemByIndex
				key={threadIds[index]}
				index={index}
				components={{ ThreadListItem }}
			/>
		));
	}

	return groups.map((group) => (
		<Fragment key={group.label}>
			<div
				data-slot="aui_thread-list-group-label"
				className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium"
			>
				{group.label}
			</div>
			{group.indices.map((index) => (
				<ThreadListPrimitive.ItemByIndex
					key={threadIds[index]}
					index={index}
					components={{ ThreadListItem }}
				/>
			))}
		</Fragment>
	));
};

export const ThreadListNew = forwardRef<
	HTMLButtonElement,
	ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
	return (
		<ThreadListPrimitive.New
			render={
				<Button
					ref={ref}
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
});

ThreadListNew.displayName = "ThreadListNew";

const ThreadListSkeleton: FC = () => {
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
					<Skeleton data-slot="aui_thread-list-skeleton" className="h-3.5 w-full" />
				</div>
			))}
		</div>
	);
};

export const ThreadListItem: FC = () => {
	const isRunning = useAuiState((s) => s.threadListItem.isRunning);
	const [isRenaming, setIsRenaming] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const restoreFocusRef = useRef(false);

	useEffect(() => {
		if (isRenaming || !restoreFocusRef.current) return;
		restoreFocusRef.current = false;
		triggerRef.current?.focus();
	}, [isRenaming]);

	return (
		<ThreadListItemPrimitive.Root
			data-slot="aui_thread-list-item"
			className={cn(
				"group relative flex h-8 w-full items-center data-active:font-medium focus-visible:outline-none",
				sidebarNavItemClassName,
			)}
		>
			{isRenaming ? (
				<ThreadListItemRename
					onDone={(restoreFocus) => {
						restoreFocusRef.current = restoreFocus;
						setIsRenaming(false);
					}}
				/>
			) : (
				<ThreadListItemPrimitive.Trigger
					ref={triggerRef}
					data-slot="aui_thread-list-item-trigger"
					className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-start text-sm outline-none group-hover:pe-9 group-has-focus-visible:pe-9 group-has-data-[state=open]:pe-9 group-data-active:pe-9 focus-visible:ring-0"
				>
					<span data-slot="aui_thread-list-item-title" className="min-w-0 flex-1 truncate">
						<ThreadListItemPrimitive.Title fallback="New Chat" />
					</span>
					{isRunning && (
						<>
							<Loader2Icon
								aria-hidden
								data-slot="aui_thread-list-item-running"
								className="text-sidebar-foreground/70 size-4 shrink-0 animate-spin"
							/>
							<span className="sr-only">Running</span>
						</>
					)}
				</ThreadListItemPrimitive.Trigger>
			)}
			<ThreadListItemMore onRename={() => setIsRenaming(true)} />
		</ThreadListItemPrimitive.Root>
	);
};

const ThreadListItemRename: FC<{
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
			data-slot="aui_thread-list-item-rename"
			aria-label="Rename thread"
			value={value}
			className="h-7 min-w-0 flex-1 ps-2 pe-9 text-sm"
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

const ThreadListItemMore: FC<{ onRename: () => void }> = ({ onRename }) => {
	const aui = useAui();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						data-slot="aui_thread-list-item-more"
						className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
						aria-label="Thread actions"
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="right" sideOffset={6}>
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => {
						void aui.threadListItem.archive();
					}}
				>
					<ArchiveIcon />
					Archive
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
