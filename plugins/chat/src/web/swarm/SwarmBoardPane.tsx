import {
	BotIcon,
	ArrowDownIcon,
	ArrowUpRightIcon,
	CheckIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	CircleAlertIcon,
	ClipboardCopyIcon,
	MessagesSquareIcon,
	EllipsisIcon,
	RefreshCwIcon,
	Trash2Icon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import { useQuery } from "@tanstack/react-query";

import { KernelTelemetry, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats, type BoardMessage } from "@kilo-desktop/plugin-core/contracts";
import { Panes, type PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";
import { Button } from "@kilo-desktop/ui/components/button";
import { Badge } from "@kilo-desktop/ui/components/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kilo-desktop/ui/components/tabs";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	AGENT_PANE_KIND,
	CHAT_TELEMETRY_EVENTS,
	chatPaneObject,
	paneChatId,
	swarmPaneRootChatId,
	type ComposerFolder,
} from "../../contracts";
import { ChatPaneOpeners } from "../panes/chat-pane-openers";
import type { ChatMirrorServices } from "../runtime/chat-mirror";
import { useOpenSubagentPane } from "../subagents/use-open-subagent-pane";
import { useChatMarkdownExtensions } from "../thread/chat-markdown";
import { useShellCopyText } from "../thread/use-shell-copy-text";
import { BoardFilterBar, type FilterAgent } from "./board-filter-bar";
import {
	boardMarkdown,
	EMPTY_FILTER,
	filterMessages,
	isFiltering,
	latestResults,
	openQuestions,
	threadsOf,
	typeCounts,
} from "./board-insights";
import {
	AgentPost,
	isLong,
	NewMessagesDivider,
	ResultsDigest,
	ThreadReplies,
	type PostContext,
} from "./board-posts";
import { useBoardFilter, useSwarmBoardStore } from "./swarm-board-store";
import { MAIN_AGENT_COLOR } from "./swarm-colors";
import { participantName } from "./swarm-team";
import { useNow } from "./swarm-time";
import { TeamRow } from "./team-section";
import { TeamRuns } from "./TeamRuns";
import { teamRuns } from "./team-timeline";
import { useSwarmBoard } from "./use-swarm-board";

export const SwarmIcon: FC<{ className?: string }> = ({ className }) => (
	<MessagesSquareIcon className={className} />
);

const NO_FOLDERS: readonly ComposerFolder[] = [];

/** Sends a `kilo.chat` telemetry event; never fails the caller. */
function useTrack() {
	const telemetry = useDomainObject(KernelTelemetry);
	return (event: string, data: Record<string, unknown> = {}) =>
		void telemetry?.methods.track({ event, data }).catch(() => undefined);
}

/**
 * The Swarm Board pane: a root chat's Kilo Swarm — the team (the main agent
 * and its subagents, each in its color, shared with its own pane) and its
 * timeline, their background jobs, and the shared board the agents
 * coordinate on. Read-only: the board is agent-to-agent, so the person
 * reads, filters and searches it, opens an agent's transcript, stops a
 * background job or clears the board, but never posts.
 */
export function createSwarmBoardPane(services: ChatMirrorServices): FC<PaneProps> {
	return (props) => <SwarmBoardPane {...props} services={services} />;
}

function SwarmBoardPane({
	pane,
	workSessionId,
	visible,
	services,
}: PaneProps & { services: ChatMirrorServices }) {
	const rootChatId = swarmPaneRootChatId(pane);
	if (!rootChatId) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyTitle>No chat to show</EmptyTitle>
					<EmptyDescription>
						Open the board from a chat that delegated work to subagents.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<ChatPaneOpeners workSessionId={workSessionId} chatId={rootChatId}>
			<SwarmBoard
				rootChatId={rootChatId}
				workSessionId={workSessionId}
				visible={visible}
				services={services}
			/>
		</ChatPaneOpeners>
	);
}

/** File links in posts, like the transcript's: the root chat's workspace folders. */
function useBoardMarkdownExtensions(rootChatId: string, workSessionId: string) {
	const workspaceFolders =
		useDomainObjectState(
			Chats,
			(state: DomainObjectState<typeof Chats>) => state.chats[rootChatId]?.workspaceFolders,
		) ?? NO_FOLDERS;
	return useChatMarkdownExtensions({ workSessionId, workspaceFolders });
}

/** Scrolls a post into view and flashes it. */
function revealPost(list: HTMLElement | null, messageId: string): boolean {
	const element = list?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
	if (!element) return false;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
	element.focus({ preventScroll: true });
	if (!reducedMotion)
		element.animate?.(
			[{ backgroundColor: "color-mix(in srgb, var(--color-primary) 18%, transparent)" }, {}],
			{ duration: 1_200, easing: "ease-out" },
		);
	return true;
}

function SwarmBoard({
	rootChatId,
	workSessionId,
	visible,
	services,
}: {
	readonly rootChatId: string;
	readonly workSessionId: string;
	readonly visible: boolean;
	readonly services: ChatMirrorServices;
}) {
	const board = useSwarmBoard(rootChatId);
	const openSubagent = useOpenSubagentPane();
	const track = useTrack();
	const copyText = useShellCopyText();
	const now = useNow();
	const extensions = useBoardMarkdownExtensions(rootChatId, workSessionId);
	const filter = useBoardFilter(rootChatId);
	const setFilter = useSwarmBoardStore((state) => state.setFilter);
	const markSeen = useSwarmBoardStore((state) => state.markSeen);
	/** How far the person had read when the board opened: the "New" divider stays put meanwhile. */
	const [seenAtOpen] = useState(() => useSwarmBoardStore.getState().seen[rootChatId]);
	const [confirmReset, setConfirmReset] = useState<number | null>(null);
	const [view, setView] = useState("activity");
	const [showTeam, setShowTeam] = useState<boolean | null>(null);
	const [wide, setWide] = useState(false);
	const teamToggleRef = useRef<HTMLButtonElement>(null);
	const teamCloseRef = useRef<HTMLButtonElement>(null);
	const teamVisible = showTeam ?? wide;
	const [copiedBoard, setCopiedBoard] = useState(false);
	/** Posts the person folded or unfolded, overriding the default (long ones fold). */
	const [folded, setFolded] = useState<ReadonlyMap<string, boolean>>(new Map());
	/** Threads the person folded; threads start open. */
	const [closedThreads, setClosedThreads] = useState<ReadonlySet<string>>(new Set());
	const [pendingJump, setPendingJump] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const previousPosts = useRef<readonly BoardMessage[]>([]);
	const readingAnchor = useRef<{ element: HTMLElement; top: number } | null>(null);
	const [arrivals, setArrivals] = useState<readonly string[]>([]);
	const viewedPosts = useRef(new Set<string>());
	const rememberPosition = () => {
		const list = listRef.current;
		if (!list || list.clientHeight === 0) return;
		const anchor = [...list.querySelectorAll<HTMLElement>("[data-message-id]")].find(
			(element) =>
				(element.firstElementChild ?? element).getBoundingClientRect().bottom >=
				list.getBoundingClientRect().top,
		);
		readingAnchor.current = anchor
			? {
					element: anchor,
					top: anchor.getBoundingClientRect().top - list.getBoundingClientRect().top,
				}
			: null;
	};
	const observeWidth = (element: HTMLDivElement | null) => {
		if (!element) return;
		const observer = new ResizeObserver(() => setWide(element.clientWidth >= 704));
		observer.observe(element);
		return () => observer.disconnect();
	};
	const closeTeam = () => {
		setShowTeam(false);
		teamToggleRef.current?.focus();
	};
	useEffect(() => {
		if (showTeam && !wide) teamCloseRef.current?.focus();
	}, [showTeam, wide]);
	const panes = useDomainObject(Panes);
	const chat = useDomainObjectState(
		Chats,
		(state: DomainObjectState<typeof Chats>) => state.chats[rootChatId],
	);
	const objective = useQuery(
		{
			queryKey: ["kilo.chat", "swarm-objective", rootChatId, chat?.directory],
			staleTime: Infinity,
			queryFn: async ({ signal }) => {
				const { data } = await services.chat.globalClient.session.messages(
					{
						sessionID: rootChatId,
						...(chat?.directory ? { directory: chat.directory } : {}),
					},
					{ throwOnError: true, signal },
				);
				const first = data
					?.filter((message) => message.info.role === "user")
					.toSorted((a, b) => a.info.time.created - b.info.time.created)[0];
				return (
					first?.parts
						.flatMap((part) =>
							part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : [],
						)
						.join(" ")
						.trim() ?? ""
				);
			},
		},
		services.queries,
	);

	const messages = board.feed.messages;
	const colorOf = (id: string) => board.colors.get(id) ?? MAIN_AGENT_COLOR;
	const nameOf = (id: string, label?: string) => participantName(id, label, board.team);
	const open = openQuestions(messages);
	const counts = typeCounts(messages);
	const results = latestResults(messages);
	const filtering = isFiltering(filter);
	const shown = filterMessages(messages, filter, rootChatId);
	const threads = threadsOf(messages);
	const runs = view === "timeline" ? teamRuns(board.team, messages, now, rootChatId) : [];
	const newest = messages.at(-1);
	const lastPostBy = new Map<string, string>();
	for (const message of messages) {
		lastPostBy.set(message.from === "main" ? rootChatId : message.from, message.body);
	}

	const openMain = () => {
		if (!panes) return;
		const existing = panes
			.getState()
			.byWorkSession[workSessionId]?.panes.find(
				(item) => item.kind === AGENT_PANE_KIND && paneChatId(item) === rootChatId,
			);
		void (
			existing
				? panes.methods.activate({ workSessionId, paneId: existing.id })
				: panes.methods.open({
						workSessionId,
						kind: AGENT_PANE_KIND,
						object: chatPaneObject(rootChatId),
					})
		).catch(() => toast.error("Could not open the chat"));
	};
	const openAgent = (chatId: string) => {
		if (chatId === "main" || chatId === rootChatId) {
			openMain();
			return;
		}
		const member = board.team.find((candidate) => candidate.chatId === chatId);
		if (!member || !openSubagent) return;
		track(CHAT_TELEMETRY_EVENTS.swarmAgentOpened);
		openSubagent(member.chatId, member.title, member.parentChatId);
	};

	const context: PostContext = {
		nameOf,
		colorOf,
		now,
		query: filter.query,
		extensions,
		onOpenSender: openAgent,
		canOpenSender: (id) =>
			id === "main" || id === rootChatId
				? !!panes
				: !!openSubagent && board.team.some((member) => member.chatId === id),
		onCopy: copyText,
	};

	useEffect(() => {
		const list = listRef.current;
		if (
			!list ||
			!visible ||
			filtering ||
			view !== "activity" ||
			confirmReset !== null ||
			(teamVisible && !wide)
		)
			return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
						const id = (entry.target as HTMLElement).dataset.readMessageId;
						if (id) viewedPosts.current.add(id);
					}
				}
				let through = useSwarmBoardStore.getState().seen[rootChatId] ?? 0;
				for (const message of messages) {
					if (message.timestamp <= through || message.from === "user") continue;
					if (!viewedPosts.current.has(message.id)) break;
					through = message.timestamp;
				}
				if (through > 0) markSeen(rootChatId, through);
				setArrivals((current) => {
					const remaining = current.filter((id) => !viewedPosts.current.has(id));
					return remaining.length === current.length ? current : remaining;
				});
			},
			{ root: list, threshold: 0.5 },
		);
		const observeAll = () => {
			for (const element of list.querySelectorAll<HTMLElement>("[data-read-message-id]"))
				observer.observe(element);
		};
		observeAll();
		// Folding a post or a thread renders read targets anew; watch those too.
		const mutations = new MutationObserver(observeAll);
		mutations.observe(list, { childList: true, subtree: true });
		return () => {
			mutations.disconnect();
			observer.disconnect();
		};
	}, [visible, filtering, view, confirmReset, messages, markSeen, rootChatId, teamVisible, wide]);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list || board.loading) return;
		const previous = previousPosts.current;
		previousPosts.current = messages;
		setArrivals((current) => {
			const remaining = current.filter((id) => messages.some((message) => message.id === id));
			return remaining.length === current.length ? current : remaining;
		});
		if (previous.length === 0) {
			if (visible && !filtering && view === "activity") list.scrollTop = list.scrollHeight;
			rememberPosition();
			return;
		}
		const ids = new Set(previous.map((message) => message.id));
		const incoming = messages.filter(
			(message) => !ids.has(message.id) && message.timestamp >= (previous.at(-1)?.timestamp ?? 0),
		);
		if (
			incoming.length > 0 &&
			visible &&
			following.current &&
			!filtering &&
			view === "activity" &&
			!incoming.some((message) => message.replyTo)
		) {
			list.scrollTop = list.scrollHeight;
		} else {
			const anchor = readingAnchor.current;
			if (anchor?.element.isConnected && previous !== messages && view === "activity")
				list.scrollTop +=
					anchor.element.getBoundingClientRect().top -
					list.getBoundingClientRect().top -
					anchor.top;
			if (incoming.length > 0)
				setArrivals((current) => [
					...new Set([...current, ...incoming.map((message) => message.id)]),
				]);
		}
		rememberPosition();
	}, [messages, board.loading, filtering, rememberPosition, view, visible]);
	const loadOlder = () => {
		rememberPosition();
		following.current = false;
		void board.loadOlder();
	};

	useEffect(() => {
		if (!pendingJump) return;
		if (revealPost(listRef.current, pendingJump)) setPendingJump(null);
	});

	/** Shows a post: unfolds it and its thread, drops a filter hiding it, then scrolls to it. */
	const jumpTo = (messageId: string) => {
		setView("activity");
		const thread = threads.find(
			(candidate) =>
				candidate.root.id === messageId ||
				candidate.replies.some((reply) => reply.id === messageId),
		);
		if (filtering && !shown.some((message) => message.id === messageId)) {
			setFilter(rootChatId, EMPTY_FILTER);
		}
		if (thread) {
			setClosedThreads((current) => {
				const next = new Set(current);
				next.delete(thread.root.id);
				return next;
			});
		}
		setFolded((current) => new Map(current).set(messageId, false));
		setPendingJump(messageId);
		setArrivals((current) => current.filter((id) => id !== messageId));
	};

	const reset = async () => {
		if (confirmReset === null) return;
		const revision = confirmReset;
		setConfirmReset(null);
		const outcome = await board.reset(revision);
		track(CHAT_TELEMETRY_EVENTS.swarmBoardReset, { outcome });
		if (outcome === "changed") {
			toast.info("The board changed", {
				description: "New messages arrived. Review them before clearing the board.",
			});
		}
	};

	const cancel = (jobId: string) => {
		track(CHAT_TELEMETRY_EVENTS.swarmJobCancelled);
		void board.cancelJob(jobId).catch((error: unknown) =>
			toast.error("Could not stop the agent", {
				description: error instanceof Error ? error.message : undefined,
			}),
		);
	};

	const copyBoard = () => {
		void copyText(boardMarkdown(shown, nameOf)).then(
			() => {
				setCopiedBoard(true);
				setTimeout(() => setCopiedBoard(false), 2_000);
			},
			() => toast.error("Could not copy the board"),
		);
	};

	if (board.loading) {
		return (
			<div className="flex h-full items-center justify-center" data-qa-id="swarm-board-loading">
				<Spinner />
			</div>
		);
	}

	const isFolded = (message: BoardMessage) =>
		folded.get(message.id) ?? (message.id !== newest?.id && isLong(message.body));
	const toggle = (message: BoardMessage) =>
		setFolded((current) => new Map(current).set(message.id, !isFolded(message)));
	const foldAll = (fold: boolean) =>
		setFolded(new Map(messages.map((message) => [message.id, fold] as const)));
	const anyOpen = shown.some((message) => !isFolded(message));
	const isNew = (message: BoardMessage) =>
		seenAtOpen !== undefined && message.timestamp > seenAtOpen && message.from !== "user";

	const post = (message: BoardMessage, options: { quoteReply: boolean }) => (
		<AgentPost
			key={message.id}
			message={message}
			context={context}
			open={open.has(message.id)}
			folded={isFolded(message)}
			onToggle={() => toggle(message)}
			replyTo={
				options.quoteReply && message.replyTo
					? messages.find((candidate) => candidate.id === message.replyTo)?.body
					: undefined
			}
		/>
	);

	const agents: FilterAgent[] = board.team.map((member) => ({
		id: member.main ? "main" : member.chatId,
		name: member.main ? "Main agent" : member.title,
		color: colorOf(member.chatId),
	}));

	const flatList = () => {
		let dividerShown = false;
		return shown.flatMap((message) => {
			const divider = !dividerShown && isNew(message);
			if (divider) dividerShown = true;
			return [
				...(divider ? [<NewMessagesDivider key="new-divider" />] : []),
				post(message, { quoteReply: true }),
			];
		});
	};

	const threadedList = () => {
		let dividerShown = false;
		return threads.flatMap((thread) => {
			const divider = !dividerShown && isNew(thread.root);
			if (divider) dividerShown = true;
			const threadOpen = !closedThreads.has(thread.root.id);
			const newReplies = thread.replies.filter(isNew).length;
			return [
				...(divider ? [<NewMessagesDivider key="new-divider" />] : []),
				<AgentPost
					key={thread.root.id}
					message={thread.root}
					context={context}
					open={open.has(thread.root.id)}
					folded={isFolded(thread.root)}
					onToggle={() => toggle(thread.root)}
					replyTo={thread.orphan ? "an earlier message, no longer loaded" : undefined}
				>
					{thread.replies.length > 0 ? (
						<ThreadReplies
							count={thread.replies.length}
							newCount={divider ? 0 : newReplies}
							open={threadOpen}
							onToggle={() =>
								setClosedThreads((current) => {
									const next = new Set(current);
									if (threadOpen) next.add(thread.root.id);
									else next.delete(thread.root.id);
									return next;
								})
							}
						>
							{thread.replies.map((reply) => post(reply, { quoteReply: false }))}
						</ThreadReplies>
					) : null}
				</AgentPost>,
			];
		});
	};

	const unavailable = board.error !== null && board.feed.revision === null;
	const attention = board.team.filter((member) => member.needsYou);
	const working = board.team.filter(
		(member) => !member.needsYou && (member.state === "working" || member.state === "retrying"),
	);
	const failed = board.team.filter((member) => member.state === "failed");
	const finished = board.team.filter(
		(member) => !member.needsYou && ["done", "cancelled", "stopped"].includes(member.state),
	);
	const attentionLabel = (member: (typeof board.team)[number]) =>
		member.attention?.includes("permission")
			? "Permission required"
			: member.attention?.includes("question")
				? "Question waiting"
				: "Needs your attention";
	const teamRow = (member: (typeof board.team)[number]) => (
		<TeamRow
			key={member.chatId}
			member={member}
			color={colorOf(member.chatId)}
			canOpen={member.main ? !!panes : !!openSubagent}
			onOpen={() => openAgent(member.chatId)}
			onStop={member.jobId ? () => cancel(member.jobId!) : undefined}
			lastPost={lastPostBy.get(member.chatId)}
		/>
	);

	return (
		<div
			ref={observeWidth}
			className="bg-pane @container/swarm flex h-full min-h-0 flex-col overflow-hidden"
			data-qa-id="swarm-board"
		>
			<header className="shrink-0 px-4 pt-3 pb-2">
				<div className="mb-2 flex items-center justify-between gap-2">
					<span className="text-muted-foreground flex items-center gap-2 text-xs">
						<MessagesSquareIcon aria-hidden className="size-3.5" /> Swarm board
					</span>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={!panes}
							onClick={openMain}
							data-qa-id="swarm-board-open-chat"
						>
							Open chat <ArrowUpRightIcon />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Board actions"
										data-qa-id="swarm-board-actions"
									/>
								}
							>
								<EllipsisIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuGroup>
									<DropdownMenuItem
										data-qa-id="swarm-board-copy"
										disabled={shown.length === 0}
										onClick={copyBoard}
									>
										{copiedBoard ? <CheckIcon /> : <ClipboardCopyIcon />}
										{filtering ? "Copy shown messages" : "Copy loaded messages"}
									</DropdownMenuItem>
									<DropdownMenuItem
										data-qa-id="swarm-board-fold-all"
										disabled={messages.length === 0}
										onClick={() => foldAll(anyOpen)}
									>
										{anyOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
										{anyOpen ? "Collapse all messages" : "Expand all messages"}
									</DropdownMenuItem>
									<DropdownMenuItem data-qa-id="swarm-board-refresh" onClick={board.refresh}>
										<RefreshCwIcon />
										Refresh snapshot
									</DropdownMenuItem>
								</DropdownMenuGroup>
								<DropdownMenuSeparator />
								<DropdownMenuGroup>
									<DropdownMenuItem
										variant="destructive"
										data-qa-id="swarm-board-reset"
										disabled={messages.length === 0 || board.feed.revision === null}
										onClick={() => setConfirmReset(board.feed.revision)}
									>
										<Trash2Icon />
										Clear shared board...
									</DropdownMenuItem>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
				<h2
					className="line-clamp-2 text-lg font-semibold tracking-tight"
					data-qa-id="swarm-board-title"
				>
					{chat?.title || "Delegated work"}
				</h2>
				<p
					className="text-muted-foreground mt-1 line-clamp-2 text-xs"
					data-qa-id="swarm-board-objective"
					title={objective.data || undefined}
				>
					{objective.data || "Follow the team's findings and review requests in their transcripts."}
				</p>
				{attention.length > 0 ? (
					<Alert
						className="border-warning/25 bg-warning-surface mt-3"
						data-qa-id="swarm-board-attention"
					>
						<CircleAlertIcon />
						<div className="col-start-2 flex min-w-0 items-center justify-between gap-3">
							<div className="min-w-0">
								<AlertTitle>
									{attention.length === 1
										? attentionLabel(attention[0]!)
										: `${attention.length} agents need your input`}
								</AlertTitle>
								<AlertDescription>
									{attention[0]!.main ? "Main agent" : attention[0]!.title} is waiting for you.
								</AlertDescription>
							</div>
							<Button
								size="sm"
								variant="outline"
								disabled={attention[0]!.main ? !panes : !openSubagent}
								onClick={() => openAgent(attention[0]!.chatId)}
								data-qa-id="swarm-board-review"
							>
								Review <ArrowUpRightIcon />
							</Button>
						</div>
					</Alert>
				) : null}
				<div
					className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 text-xs"
					data-qa-id="swarm-team-summary"
				>
					<span>
						<strong className="text-foreground font-medium">{working.length}</strong> working
					</span>
					{attention.length > 0 ? <span>{attention.length} needs input</span> : null}
					{failed.length > 0 ? (
						<span className="text-destructive">{failed.length} failed</span>
					) : null}
					<span>{finished.length} finished</span>
					<Button
						ref={teamToggleRef}
						variant="ghost"
						size="sm"
						className="ms-auto"
						aria-label="Toggle team"
						aria-expanded={teamVisible}
						data-qa-id="swarm-team-toggle"
						onClick={() => setShowTeam(!teamVisible)}
					>
						<UsersIcon />
						Team
					</Button>
				</div>
			</header>
			<div className="relative flex min-h-0 flex-1 gap-4 px-4 pb-3">
				<Tabs
					value={view}
					onValueChange={(value) => setView(String(value))}
					className={cn("min-h-0 min-w-0 flex-1 flex-col", teamVisible && !wide && "hidden")}
				>
					<TabsList variant="line" aria-label="Board views" className="shrink-0">
						<TabsTrigger value="activity" data-qa-id="swarm-activity-tab">
							Activity
						</TabsTrigger>
						<TabsTrigger value="results" data-qa-id="swarm-results-tab">
							Results <Badge variant="secondary">{results.length}</Badge>
						</TabsTrigger>
						<TabsTrigger value="timeline" data-qa-id="swarm-timeline-toggle">
							Timeline
						</TabsTrigger>
					</TabsList>
					{unavailable ? (
						<Empty className="shrink-0 py-4" data-qa-id="swarm-board-unavailable">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MessagesSquareIcon />
								</EmptyMedia>
								<EmptyTitle>The board isn't available for this chat</EmptyTitle>
								<EmptyDescription>
									The board could not be loaded. Refresh to retry; this chat may not support Kilo
									Swarm.
								</EmptyDescription>
								<p className="text-muted-foreground/70 mt-1 text-xs">{board.error}</p>
							</EmptyHeader>
						</Empty>
					) : board.error ? (
						<Alert variant="destructive" className="shrink-0" data-qa-id="swarm-board-error">
							<CircleAlertIcon />
							<AlertTitle>Board update incomplete</AlertTitle>
							<AlertDescription>{board.error}</AlertDescription>
						</Alert>
					) : null}
					<TabsContent
						value="activity"
						keepMounted
						className="flex min-h-0 flex-col data-[hidden]:hidden"
					>
						{messages.length > 0 ? (
							<BoardFilterBar
								filter={filter}
								onChange={(next) => setFilter(rootChatId, next)}
								agents={agents}
								counts={counts}
								openCount={open.size}
								shown={shown.length}
								total={messages.length}
								hasMore={board.feed.hasMore}
							/>
						) : null}
						<div
							ref={listRef}
							className="min-h-0 flex-1 overflow-y-auto py-3 pe-1 [overflow-anchor:none]"
							data-qa-id="swarm-board-messages"
							onScroll={(event) => {
								const list = event.currentTarget;
								following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
								rememberPosition();
							}}
						>
							{board.feed.hasMore ? (
								<div className="mb-3 flex justify-center">
									<Button
										size="sm"
										variant="ghost"
										disabled={board.loadingOlder}
										onClick={loadOlder}
										data-qa-id="swarm-board-older"
									>
										{board.loadingOlder ? <Spinner /> : null}
										Show older messages
									</Button>
								</div>
							) : null}
							{unavailable ? null : messages.length === 0 ? (
								<Empty className="py-10" data-qa-id="swarm-board-empty">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<BotIcon />
										</EmptyMedia>
										<EmptyTitle>Nothing on the board yet</EmptyTitle>
										<EmptyDescription>
											Subagents post findings and questions here as they work.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								<>
									{filtering && shown.length === 0 ? (
										<p
											className="text-muted-foreground py-8 text-center text-sm"
											data-qa-id="swarm-board-no-match"
										>
											No matches in loaded history.
											{board.feed.hasMore ? " Load earlier messages to search more." : ""}
										</p>
									) : (
										<ol className="flex flex-col gap-5">
											{filtering ? flatList() : threadedList()}
										</ol>
									)}
								</>
							)}
						</div>
						{arrivals.length > 0 ? (
							<div className="flex shrink-0 items-center justify-between gap-2 border-t pt-2">
								<span className="text-muted-foreground text-xs">
									Your reading position is preserved
								</span>
								<Button
									variant="outline"
									size="sm"
									data-qa-id="swarm-board-new-messages"
									onClick={() => jumpTo(arrivals[0]!)}
								>
									{arrivals.length} new {arrivals.length === 1 ? "message" : "messages"}
									<ArrowDownIcon />
								</Button>
							</div>
						) : null}
					</TabsContent>
					<TabsContent value="results" className="min-h-0 overflow-y-auto px-1 py-3">
						<ResultsDigest
							results={results}
							context={context}
							onJump={jumpTo}
							hasMore={board.feed.hasMore}
							loadedCount={messages.length}
						/>
					</TabsContent>
					<TabsContent value="timeline" className="min-h-0 overflow-y-auto py-3">
						<h3 className="text-sm font-medium">Coordination over time</h3>
						<p className="text-muted-foreground mt-1 mb-4 text-xs">
							Inspect a post, then open its source in Activity. Based on loaded history.
						</p>
						<TeamRuns
							runs={runs}
							messages={messages}
							mainChatId={rootChatId}
							colorOf={colorOf}
							nameOf={nameOf}
							onJump={jumpTo}
							more={board.feed.hasMore}
						/>
					</TabsContent>
				</Tabs>
				<aside
					aria-label="Team"
					data-qa-id="swarm-team"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							closeTeam();
						}
					}}
					className={cn(
						"bg-pane min-h-0 w-full overflow-y-auto py-3 @min-[44rem]/swarm:w-64 @min-[44rem]/swarm:shrink-0 @min-[44rem]/swarm:border-s @min-[44rem]/swarm:ps-4",
						teamVisible ? "block" : "hidden",
					)}
				>
					<div className="mb-2 flex items-center justify-between">
						<h3 className="text-muted-foreground text-xs font-medium">Team</h3>
						<Button
							ref={teamCloseRef}
							size="icon-sm"
							variant="ghost"
							aria-label="Close team"
							onClick={closeTeam}
						>
							<XIcon />
						</Button>
					</div>
					{board.team
						.filter((member) => !finished.includes(member))
						.toSorted(
							(a, b) =>
								Number(b.needsYou) - Number(a.needsYou) ||
								Number(b.state === "failed") - Number(a.state === "failed"),
						)
						.map(teamRow)}
					{finished.length > 0 ? (
						<details className="mt-3">
							<summary className="text-muted-foreground cursor-pointer py-2 text-xs">
								Finished · {finished.length}
							</summary>
							{finished.map(teamRow)}
						</details>
					) : null}
				</aside>
			</div>
			<AlertDialog
				open={confirmReset !== null}
				onOpenChange={(value) => {
					if (!value) setConfirmReset(null);
				}}
			>
				<AlertDialogContent data-qa-id="swarm-board-reset-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Clear the board?</AlertDialogTitle>
						<AlertDialogDescription>
							Removes the board's messages for every agent. Conversations and running work are not
							affected. New arrivals require another review before clearing.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							data-qa-id="swarm-board-reset-confirm"
							onClick={() => void reset()}
						>
							Clear board
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
