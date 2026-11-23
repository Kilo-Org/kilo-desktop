import {
	ArrowUpRightIcon,
	BookmarkIcon,
	MessageSquareIcon,
	SearchIcon,
	SquareTerminalIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FC } from "react";

import {
	useDomainObject,
	useDomainObjectState,
	useExtensions,
	useSdk,
} from "@kilo-desktop/kernel/web";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Input } from "@kilo-desktop/ui/components/input";
import { SavedToast } from "@kilo-desktop/ui/components/reading/saved-toast";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { ageBucket, countBucket, lengthBucket } from "@kilo-desktop/ui/lib/reading/buckets";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	SavedItems,
	SavedSource,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type SavedItem,
	type SavedItemsState,
	type SavedPresentation,
	type WorkSession,
	type WorkSessionsState,
	type WorkSessionsWindowState,
	type WorkspacesState,
} from "../../contracts";
import { useNow } from "../list/session-row-display";
import { useTracker } from "../shared/telemetry";

export const SAVED_VIEW_KEY = "kilo.work-sessions/saved";

type Filter = "all" | "chats" | "text";
const FILTERS: readonly { value: Filter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "chats", label: "Chats" },
	{ value: "text", label: "Text" },
];

const NO_ITEMS: readonly SavedItem[] = [];
const selectItems = (state: SavedItemsState) => state.items;
const selectWorkSessions = (state: WorkSessionsState) => state.workSessions;
const selectWorkspaces = (state: WorkspacesState) => state.workspaces;
const selectActive = (state: WorkSessionsWindowState) => state.activeWorkSessionId;

interface Group {
	readonly workSessionId: string;
	readonly heading: string;
	readonly current: boolean;
	readonly items: readonly SavedItem[];
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
/** How old an item is now, bucketed for telemetry (read when an action happens). */
const ageOf = (item: SavedItem) => ageBucket(Date.now() - item.createdAt);

function timeAgo(at: number, now: number): string {
	const minutes = Math.round((at - now) / 60_000);
	if (minutes === 0) return "just now";
	if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
	return relativeTime.format(Math.round(hours / 24), "day");
}

/**
 * The Saved page: every bookmarked chat and saved passage, grouped by work
 * session (the window's open one first, tagged "This session", then by their
 * newest item), searchable and filtered by kind. A row opens its source,
 * which scrolls to the passage; rows can be removed with Undo.
 */
export const SavedView: FC = () => {
	const sdk = useSdk();
	const track = useTracker();
	const saved = useDomainObject(SavedItems);
	const items = useDomainObjectState(SavedItems, selectItems) ?? NO_ITEMS;
	const workSessions = useDomainObjectState(WorkSessions, selectWorkSessions) ?? [];
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? [];
	const activeWorkSessionId = useDomainObjectState(WorkSessionsWindow, selectActive) ?? null;
	const sources = useExtensions(SavedSource);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const now = useNow(30_000);

	const sourceOf = (item: SavedItem) => sources.find((source) => source.key === item.source);
	const filterOf = (item: SavedItem): Exclude<Filter, "all"> =>
		sourceOf(item)?.metadata.filter ?? (item.text ? "text" : "chats");

	const workSessionById = new Map(workSessions.map((workSession) => [workSession.id, workSession]));
	const headingOf = (workSession: WorkSession | undefined, item: SavedItem) => {
		const name = workSession?.title || item.title || "Untitled session";
		const workspace = workspaces.find((candidate) => candidate.id === workSession?.workspaceId);
		return workspace ? `${name} · ${workspace.name}` : name;
	};

	const needle = query.trim().toLowerCase();
	const matching = items.filter((item) => {
		if (filter !== "all" && filterOf(item) !== filter) return false;
		if (!needle) return true;
		const workSession = workSessionById.get(item.workSessionId);
		return [item.text, item.title, headingOf(workSession, item)].some((term) =>
			term.toLowerCase().includes(needle),
		);
	});

	const groups: Group[] = [];
	for (const item of matching) {
		let group = groups.find((candidate) => candidate.workSessionId === item.workSessionId);
		if (!group) {
			group = {
				workSessionId: item.workSessionId,
				heading: headingOf(workSessionById.get(item.workSessionId), item),
				current: item.workSessionId === activeWorkSessionId,
				items: [],
			};
			groups.push(group);
		}
		(group.items as SavedItem[]).push(item);
	}
	groups.sort((a, b) => Number(b.current) - Number(a.current));

	const counts: Record<Filter, number> = {
		all: items.length,
		chats: items.filter((item) => filterOf(item) === "chats").length,
		text: items.filter((item) => filterOf(item) === "text").length,
	};

	// One "searched" event per search, once typing settles.
	const lastSearched = useRef("");
	useEffect(() => {
		if (!needle || needle === lastSearched.current) return;
		const timer = setTimeout(() => {
			lastSearched.current = needle;
			track("saved-page-searched", {
				queryLength: lengthBucket(needle.length),
				results: countBucket(matching.length),
			});
		}, 800);
		return () => clearTimeout(timer);
	}, [lastSearched, matching.length, needle, track]);

	const open = async (item: SavedItem, position: number) => {
		const source = sourceOf(item);
		const implementation = source?.implementation;
		let resolved: "exact" | "message" | "unavailable" = "unavailable";
		try {
			resolved = implementation
				? await implementation.reveal(item, { windowId: sdk.windowId ?? "main" })
				: "unavailable";
		} catch {
			track("saved-action-failed", {
				action: "open",
				kind: kindOf(item, source?.metadata.presentation),
			});
		}
		track("saved-item-opened", {
			kind: kindOf(item, source?.metadata.presentation),
			ageBucket: ageOf(item),
			sameSession: item.workSessionId === activeWorkSessionId,
			resolved,
			position: Math.min(position, 50),
		});
		if (resolved === "unavailable") {
			toast("Couldn't find where this was saved", {
				description: "The chat or passage may have been removed.",
			});
		}
	};

	const remove = async (item: SavedItem) => {
		const kind = kindOf(item, sourceOf(item)?.metadata.presentation);
		try {
			const { removed } = (await saved?.methods.remove({ id: item.id })) ?? { removed: null };
			track("saved-item-removed", {
				kind,
				via: "saved-page",
				ageBucket: ageOf(item),
			});
			if (!removed) return;
			// The same toast Save shows in the chat, so both read alike; it times
			// itself out, so the stack keeps it until it closes.
			toast.custom(
				(id) => (
					<SavedToast
						message="Removed from Saved"
						onUndo={() => {
							void saved?.methods.restore({ item: removed }).catch(() => {
								track("saved-action-failed", { action: "restore", kind });
							});
						}}
						onClose={() => toast.dismiss(id)}
						dismissible
						className="ml-auto w-fit"
						qaId="saved-page-toast"
					/>
				),
				{ duration: Number.POSITIVE_INFINITY },
			);
		} catch {
			track("saved-action-failed", { action: "remove", kind });
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-qa-id="saved-view">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
				<header className="flex flex-col gap-1">
					<h1 className="text-lg font-semibold">Saved</h1>
					<p className="text-muted-foreground text-sm">
						Chats you’ve bookmarked and text you’ve saved, from every session.
					</p>
				</header>
				<div className="relative">
					<SearchIcon
						aria-hidden="true"
						className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
					/>
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search saved"
						aria-label="Search saved"
						className="pl-8"
						data-qa-id="saved-search"
					/>
				</div>
				<div
					role="radiogroup"
					aria-label="Show"
					className="flex gap-1.5"
					data-qa-id="saved-filters"
				>
					{FILTERS.map(({ value, label }) => (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={filter === value}
							data-qa-id={`saved-filter-${value}`}
							onClick={() => {
								setFilter(value);
								track("saved-page-filtered", { filter: value });
							}}
							className={cn(
								"border-border-subtle text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
								filter === value && "bg-state-selected text-foreground border-transparent",
							)}
						>
							{label}
							<span className="tabular-nums opacity-70">{counts[value]}</span>
						</button>
					))}
				</div>

				{groups.length === 0 ? (
					<Empty data-qa-id={items.length === 0 ? "saved-empty" : "saved-no-matches"}>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<BookmarkIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>{items.length === 0 ? "Nothing saved yet" : "No matches"}</EmptyTitle>
							<EmptyDescription>
								{items.length === 0
									? "Select text in a reply and choose Save, or bookmark a chat from its reply."
									: "Try another search or filter."}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					groups.map((group) => (
						<section
							key={group.workSessionId}
							aria-label={group.heading}
							className="flex flex-col gap-1"
							data-qa-id="saved-group"
						>
							<h2 className="text-muted-foreground flex items-center gap-2 px-2 text-xs font-medium">
								<span className="truncate">{group.heading}</span>
								{group.current ? (
									<span
										className="bg-muted text-foreground rounded px-1.5 py-0.5 text-[10px]"
										data-qa-id="saved-this-session"
									>
										This session
									</span>
								) : null}
							</h2>
							<ul className="flex flex-col">
								{group.items.map((item) => (
									<SavedRow
										key={item.id}
										item={item}
										presentation={sourceOf(item)?.metadata.presentation ?? "quote"}
										now={now}
										onOpen={() => void open(item, matching.indexOf(item))}
										onRemove={() => void remove(item)}
									/>
								))}
							</ul>
						</section>
					))
				)}
			</div>
		</div>
	);
};

function kindOf(
	item: SavedItem,
	presentation: SavedPresentation | undefined,
): "text" | "chat" | "output" {
	if (presentation === "bookmark") return "chat";
	if (presentation === "output") return "output";
	return item.text ? "text" : "chat";
}

const SavedRow: FC<{
	item: SavedItem;
	presentation: SavedPresentation;
	now: number;
	onOpen: () => void;
	onRemove: () => void;
}> = ({ item, presentation, now, onOpen, onRemove }) => {
	const time = timeAgo(item.createdAt, now);
	const firstLine = item.text.split("\n", 1)[0] ?? "";
	return (
		<li className="group/saved relative" data-qa-id="saved-row" data-presentation={presentation}>
			<button
				type="button"
				onClick={onOpen}
				className="hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-ring/50 flex w-full items-start gap-3 rounded-lg px-2 py-2 pr-16 text-left outline-none focus-visible:ring-2"
				data-qa-id="saved-row-open"
			>
				{presentation === "bookmark" ? (
					<MessageSquareIcon
						aria-hidden="true"
						className="text-muted-foreground mt-0.5 size-4 shrink-0"
					/>
				) : presentation === "output" ? (
					<SquareTerminalIcon
						aria-hidden="true"
						className="text-muted-foreground mt-0.5 size-4 shrink-0"
					/>
				) : (
					<span
						aria-hidden="true"
						className="bg-border mt-0.5 w-0.5 shrink-0 self-stretch rounded-full"
					/>
				)}
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className={cn(
							"text-foreground text-sm",
							presentation === "bookmark" && "truncate font-medium",
							presentation === "quote" && "line-clamp-3",
							presentation === "output" && "truncate font-mono text-xs",
						)}
					>
						{presentation === "bookmark"
							? item.title || "Untitled chat"
							: presentation === "output"
								? firstLine
								: item.text}
					</span>
					<span className="text-muted-foreground truncate text-xs">
						{presentation === "bookmark"
							? `Bookmarked chat · ${time}`
							: `${item.title || "Untitled"} · ${time}`}
					</span>
				</span>
			</button>
			<span className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/saved:opacity-100 group-hover/saved:opacity-100">
				<button
					type="button"
					aria-label="Remove from Saved"
					onClick={onRemove}
					data-qa-id="saved-row-remove"
					className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded outline-none focus-visible:ring-2"
				>
					<XIcon aria-hidden="true" className="size-3.5" />
				</button>
				<ArrowUpRightIcon
					aria-hidden="true"
					className="text-muted-foreground pointer-events-none size-4"
				/>
			</span>
		</li>
	);
};
