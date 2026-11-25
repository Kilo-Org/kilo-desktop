import {
	ArrowDownIcon,
	ArrowUpRightIcon,
	CheckIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	ClipboardCopyIcon,
	EllipsisIcon,
	MessageSquareIcon,
	MessagesSquareIcon,
	SquareIcon,
	Trash2Icon,
	WaypointsIcon,
	XIcon,
} from "lucide-react";
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	type FC,
	type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { KernelTelemetry, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats, Swarm, type BoardMessage } from "@kilo-desktop/plugin-core/contracts";
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
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	AGENT_PANE_KIND,
	CHAT_TELEMETRY_EVENTS,
	chatPaneObject,
	paneChatId,
	SWARM_PANE_KIND,
	swarmConversationMetadata,
	swarmConversationPaneId,
	swarmPaneConversation,
	swarmPaneRootChatId,
	type ComposerFolder,
} from "../../contracts";
import { OpenCodePermissionCard } from "../interactions/opencode-permission-card";
import { OpenCodeQuestionQuestionnaire } from "../interactions/opencode-question-card";
import {
	PendingInteractionsProvider,
	usePendingInteractions,
} from "../interactions/PendingInteractionsContext";
import { ChatPaneOpeners } from "../panes/chat-pane-openers";
import { isPlanFollowupRequest } from "../plan/plan-followup";
import { ChatMirror, type ChatMirrorServices } from "../runtime/chat-mirror";
import { useOpenSubagentPane } from "../subagents/use-open-subagent-pane";
import { useChatMarkdownExtensions } from "../thread/chat-markdown";
import { useShellCopyText } from "../thread/use-shell-copy-text";
import { postNumbers } from "./board-feed";
import {
	boardMarkdown,
	EMPTY_FILTER,
	filterMessages,
	isBlocking,
	isFiltering,
	type BoardFilter,
} from "./board-insights";
import {
	BoardPost,
	FailedAgentCard,
	isLong,
	NeedsYouItem,
	NewPostsDivider,
	SwarmDoneMarker,
	WritingIndicator,
	type PostContext,
} from "./board-posts";
import { BoardSearch, SEARCH_FROM_POSTS } from "./board-search";
import { MembersView } from "./MembersView";
import { postRefsExtension } from "./remark-post-refs";
import { useBoardFilter, useSwarmBoardStore, type BoardFocus } from "./swarm-board-store";
import { MAIN_AGENT_COLOR } from "./swarm-colors";
import type { GraphMember, GraphPost } from "./swarm-graph";
import { SwarmGraph } from "./SwarmGraph";
import { AgentAvatar } from "./swarm-parts";
import { isActive, participantName, type TeamMember } from "./swarm-team";
import { clockTime, useNow } from "./swarm-time";
import { useAgentActivity } from "./use-agent-activity";
import { useSwarmBoard, type SwarmBoardView } from "./use-swarm-board";

export const SwarmIcon: FC<{ className?: string }> = ({ className }) => (
	<MessagesSquareIcon className={className} />
);

const NO_FOLDERS: readonly ComposerFolder[] = [];
/** Kilo's board name for the root chat. */
const MAIN = "main";

/** Sends a `kilo.chat` telemetry event; never fails the caller. */
function useTrack() {
	const telemetry = useDomainObject(KernelTelemetry);
	return (event: string, data: Record<string, unknown> = {}) =>
		void telemetry?.methods.track({ event, data }).catch(() => undefined);
}

/**
 * The Swarm Board pane: a root chat's Kilo Swarm as a live conversation.
 * Board shows the agents' posts as messages (sender → recipient · #n · time),
 * with what waits on the person (questions, permission prompts) answered in
 * place, failures, who is writing and when the swarm is done. Members shows
 * each agent and what it is doing; Graph who talks to whom. A conversation
 * pane (metadata names two agents) shows only their posts. The person never
 * posts: they answer prompts, stop agents, open transcripts or clear the board.
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
		<ChatMirror services={services} workSessionId={workSessionId} chatId={rootChatId}>
			<PendingInteractionsProvider>
				<ChatPaneOpeners workSessionId={workSessionId} chatId={rootChatId}>
					<SwarmBoard
						rootChatId={rootChatId}
						workSessionId={workSessionId}
						visible={visible}
						services={services}
						conversation={swarmPaneConversation(pane)}
					/>
				</ChatPaneOpeners>
			</PendingInteractionsProvider>
		</ChatMirror>
	);
}

/** Scrolls an element of the feed into view and flashes it. */
function reveal(list: HTMLElement | null, selector: string): boolean {
	const element = list?.querySelector<HTMLElement>(selector);
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

const postSelector = (messageId: string) => `[data-message-id="${CSS.escape(messageId)}"]`;
const questionSelector = (chatId: string) => `[data-needs-you-chat="${CSS.escape(chatId)}"]`;

/** Where a focus request asked before the board opened points in the feed. */
function revealFor(focus: BoardFocus | undefined): string | null {
	if (focus?.kind === "post") return postSelector(focus.messageId);
	return focus?.kind === "question" ? questionSelector(focus.chatId) : null;
}

/** The header's one status: what needs the person first, then failures, work, and the end. */
function StatusPill({
	board,
	finishedAt,
}: {
	board: SwarmBoardView;
	finishedAt: number | undefined;
}) {
	const needsYou = board.team.filter((member) => member.needsYou).length;
	const failed = board.team.filter((member) => member.state === "failed").length;
	const working = board.team.some((member) => isActive(member.state));
	const pill = (tone: string, text: string, qa: string) => (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1.5 rounded-full px-[9px] py-[3px] text-xs font-medium",
				tone,
			)}
			data-qa-id="swarm-board-status"
			data-status={qa}
		>
			<span aria-hidden className="size-1.5 rounded-full bg-current" />
			{text}
		</span>
	);
	if (needsYou > 0)
		return pill("bg-foreground/10 text-foreground", `${needsYou} needs you`, "needs-you");
	if (failed > 0) return pill("bg-destructive/12 text-destructive", `${failed} failed`, "failed");
	if (working)
		return (
			<span
				className="text-success flex shrink-0 items-center gap-1.5 text-xs"
				data-qa-id="swarm-board-status"
				data-status="live"
			>
				<span aria-hidden className="size-1.5 rounded-full bg-current" />
				Live
			</span>
		);
	return (
		<span
			className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs"
			data-qa-id="swarm-board-status"
			data-status="done"
		>
			<CheckIcon aria-hidden className="size-3" />
			Done{finishedAt ? ` ${clockTime(finishedAt)}` : ""}
		</span>
	);
}

/** "1 failed · 5 working · 1 done": the workers, what waits on the person first. */
function TeamSummary({ team }: { team: readonly TeamMember[] }) {
	const workers = team.filter((member) => !member.main);
	const needsYou = workers.filter((member) => member.needsYou).length;
	const failed = workers.filter((member) => member.state === "failed").length;
	const working = workers.filter((member) => !member.needsYou && isActive(member.state)).length;
	const done = workers.filter(
		(member) => !member.needsYou && ["done", "cancelled", "stopped"].includes(member.state),
	).length;
	const parts: ReactNode[] = [];
	if (needsYou)
		parts.push(
			<span key="needs" className="text-foreground">
				{needsYou} needs you
			</span>,
		);
	if (failed)
		parts.push(
			<span key="failed" className="text-destructive">
				{failed} failed
			</span>,
		);
	if (working || parts.length === 0) parts.push(`${working} working`);
	if (done) parts.push(`${done} done`);
	return (
		<span className="text-muted-foreground truncate" data-qa-id="swarm-team-summary">
			{parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}
		</span>
	);
}

/** File links and `#n` chips in posts. */
function usePostExtensions(
	rootChatId: string,
	workSessionId: string,
	numbers: ReadonlyMap<string, number>,
) {
	const workspaceFolders =
		useDomainObjectState(
			Chats,
			(state: DomainObjectState<typeof Chats>) => state.chats[rootChatId]?.workspaceFolders,
		) ?? NO_FOLDERS;
	const files = useChatMarkdownExtensions({ workSessionId, workspaceFolders });
	const refs = postRefsExtension(new Set(numbers.values()));
	return refs ? [...files, refs] : files;
}

/** Watches a working agent: says when it's writing to the board. */
function WorkerWatch({
	member,
	services,
	name,
}: {
	member: TeamMember;
	services: ChatMirrorServices;
	name: string;
}) {
	const chat = useDomainObjectState(
		Chats,
		(state: DomainObjectState<typeof Chats>) => state.chats[member.chatId],
	);
	const activity = useAgentActivity(services, member.chatId, {
		...(chat?.directory ? { directory: chat.directory } : {}),
		...(chat ? { updatedAt: chat.updatedAt } : {}),
	});
	return activity?.writingToBoard ? <WritingIndicator name={name} /> : null;
}

/** A failed worker's card, with the files its edits touched. */
function FailedWorker({
	member,
	services,
	onOpen,
	canOpen,
}: {
	member: TeamMember;
	services: ChatMirrorServices;
	onOpen: () => void;
	canOpen: boolean;
}) {
	const chat = useDomainObjectState(
		Chats,
		(state: DomainObjectState<typeof Chats>) => state.chats[member.chatId],
	);
	const activity = useAgentActivity(services, member.chatId, {
		...(chat?.directory ? { directory: chat.directory } : {}),
		...(chat ? { updatedAt: chat.updatedAt } : {}),
	});
	return (
		<FailedAgentCard
			member={member}
			editedFiles={activity?.editedFiles ?? []}
			onOpen={onOpen}
			canOpen={canOpen}
		/>
	);
}

/** Each worker's own cost, read from Kilo while the Members tab shows. */
function useMemberCosts(team: readonly TeamMember[], enabled: boolean) {
	const swarm = useDomainObject(Swarm);
	const ids = team.filter((member) => !member.main).map((member) => member.chatId);
	const query = useQuery({
		queryKey: ["kilo.chat", "swarm-member-costs", ids.join(",")],
		enabled: enabled && !!swarm?.methods.usage && ids.length > 0,
		staleTime: 15_000,
		queryFn: async () =>
			new Map(
				await Promise.all(
					ids.map(
						async (chatId) =>
							[
								chatId,
								await swarm!.methods
									.usage({ chatId })
									.then((usage) => usage?.ownCost ?? usage?.cost)
									.catch(() => undefined),
							] as const,
					),
				),
			),
	});
	return (chatId: string) => query.data?.get(chatId);
}

function SwarmBoard({
	rootChatId,
	workSessionId,
	visible,
	services,
	conversation,
}: {
	readonly rootChatId: string;
	readonly workSessionId: string;
	readonly visible: boolean;
	readonly services: ChatMirrorServices;
	readonly conversation: readonly [string, string] | null;
}) {
	const board = useSwarmBoard(rootChatId);
	const openSubagent = useOpenSubagentPane();
	const track = useTrack();
	const copyText = useShellCopyText();
	const now = useNow();
	const panes = useDomainObject(Panes);
	const interactions = usePendingInteractions();
	const storedFilter = useBoardFilter(rootChatId);
	const setStoredFilter = useSwarmBoardStore((state) => state.setFilter);
	const markSeen = useSwarmBoardStore((state) => state.markSeen);
	const clearFocus = useSwarmBoardStore((state) => state.clearFocus);
	const chats = useDomainObjectState(
		Chats,
		(state: DomainObjectState<typeof Chats>) => state.chats,
	);
	/** How far the person had read when the board opened: the divider stays put meanwhile. */
	const [seenAtOpen] = useState(() => useSwarmBoardStore.getState().seen[rootChatId]);
	const [confirmReset, setConfirmReset] = useState<number | null>(null);
	const [confirmStopAll, setConfirmStopAll] = useState(false);
	/** The feed, or who talks to whom (from the ⋯ menu). */
	const [view, setView] = useState<"board" | "graph">("board");
	/** The Team row is open, listing each agent and what it is doing. */
	const [teamOpen, setTeamOpen] = useState(false);
	const [copiedBoard, setCopiedBoard] = useState(false);
	/** Posts the person folded or unfolded, overriding the default (long ones fold). */
	const [folded, setFolded] = useState<ReadonlyMap<string, boolean>>(new Map());
	const [pendingReveal, setPendingReveal] = useState<string | null>(() =>
		revealFor(useSwarmBoardStore.getState().focus[rootChatId]),
	);
	const listRef = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const previousPosts = useRef<readonly BoardMessage[]>([]);
	const readingAnchor = useRef<{ element: HTMLElement; top: number } | null>(null);
	const [arrivals, setArrivals] = useState<readonly string[]>([]);
	const viewedPosts = useRef(new Set<string>());
	const filter: BoardFilter = conversation
		? { ...EMPTY_FILTER, agents: new Set(conversation), direction: "between" }
		: storedFilter;
	const setFilter = (next: BoardFilter) => setStoredFilter(rootChatId, next);

	const messages = board.feed.messages;
	const numbers = postNumbers(board.feed);
	const extensions = usePostExtensions(rootChatId, workSessionId, numbers);
	const colorOf = (id: string) => board.colors.get(id) ?? MAIN_AGENT_COLOR;
	const nameOf = (id: string, label?: string) => participantName(id, label, board.team);
	const memberOf = (id: string) =>
		board.team.find((member) => (id === MAIN ? member.main : member.chatId === id));
	const boardId = (member: TeamMember) => (member.main ? MAIN : member.chatId);
	const filtering = isFiltering(filter);
	const shown = filterMessages(messages, filter, { mainChatId: rootChatId, nameOf, numbers });
	const newest = messages.at(-1);
	const workers = board.team.filter((member) => !member.main);
	const working = board.team.filter((member) => isActive(member.state));
	const failed = workers.filter((member) => member.state === "failed");
	const settled = workers.length > 0 && working.length === 0;
	const finishedAt = settled
		? Math.max(0, ...workers.map((member) => member.completedAt ?? 0)) || undefined
		: undefined;
	const startedAt = Math.min(...workers.map((member) => member.startedAt ?? Infinity));
	const questions = interactions.questions.filter((question) => !isPlanFollowupRequest(question));
	const waiting = [
		...interactions.permissions.map((request) => ({
			kind: "permission" as const,
			chatId: request.sessionId,
			askedAt: request.askedAt,
			request,
		})),
		...questions.map((request) => ({
			kind: "question" as const,
			chatId: request.sessionID,
			askedAt: request.askedAt,
			request,
		})),
	].toSorted((a, b) => a.askedAt - b.askedAt);
	const chipCounts = {
		"needs-you": waiting.length,
		blocking: messages.filter(isBlocking).length,
		mentions: messages.filter((message) => message.to === "user").length,
	};

	const rememberPosition = () => {
		const list = listRef.current;
		if (!list || list.clientHeight === 0) return;
		const anchor = [...list.querySelectorAll<HTMLElement>("[data-message-id]")].find(
			(element) => element.getBoundingClientRect().bottom >= list.getBoundingClientRect().top,
		);
		readingAnchor.current = anchor
			? {
					element: anchor,
					top: anchor.getBoundingClientRect().top - list.getBoundingClientRect().top,
				}
			: null;
	};

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
	/** Opens an agent's transcript beside the board, which narrows to that agent's posts. */
	const openAgent = (id: string) => {
		if (id === MAIN || id === rootChatId) {
			openMain();
			return;
		}
		const member = memberOf(id);
		if (!member || !openSubagent) return;
		track(CHAT_TELEMETRY_EVENTS.swarmAgentOpened);
		openSubagent(member.chatId, member.title, member.parentChatId);
		if (!conversation) setFilter({ ...EMPTY_FILTER, agents: new Set([id]) });
	};
	const canOpen = (id: string) =>
		id === MAIN || id === rootChatId ? !!panes : !!openSubagent && !!memberOf(id);
	const openConversation = (a: string, b: string) => {
		if (!panes) return;
		void panes.methods
			.open({
				workSessionId,
				kind: SWARM_PANE_KIND,
				paneId: swarmConversationPaneId(rootChatId, a, b),
				title: `${nameOf(a)} ↔ ${nameOf(b)}`,
				object: chatPaneObject(rootChatId),
				metadata: swarmConversationMetadata(a, b),
				placement: "tab",
			})
			.catch(() => toast.error("Could not open the conversation"));
	};
	const stop = (member: TeamMember) => {
		if (!member.jobId) return;
		track(CHAT_TELEMETRY_EVENTS.swarmJobCancelled);
		void board.cancelJob(member.jobId).catch((error: unknown) =>
			toast.error(`Could not stop ${member.title}`, {
				description: error instanceof Error ? error.message : undefined,
			}),
		);
	};
	const stopAll = () => {
		setConfirmStopAll(false);
		for (const member of workers) if (member.jobId) stop(member);
	};

	/** Shows a post: unfolds it, drops a filter hiding it, then scrolls to it. */
	const jumpTo = (messageId: string) => {
		setView("board");
		if (filtering && !conversation && !shown.some((message) => message.id === messageId)) {
			setFilter(EMPTY_FILTER);
		}
		setFolded((current) => new Map(current).set(messageId, false));
		setPendingReveal(postSelector(messageId));
		setArrivals((current) => current.filter((id) => id !== messageId));
	};
	const jumpToNumber = (number: number) => {
		const id = [...numbers].find(([, n]) => n === number)?.[0];
		if (id) jumpTo(id);
	};

	const context: PostContext = {
		nameOf,
		colorOf,
		now,
		numbers,
		query: filter.query,
		extensions,
		memberOf,
		onOpenSender: openAgent,
		canOpenSender: canOpen,
		onStop: stop,
		onJump: jumpTo,
	};

	/** Shows what another surface asked for (the composer's Answer, an agent pane's post). */
	const applyFocus = useEffectEvent((focus: BoardFocus) => {
		if (focus.kind === "post") {
			jumpTo(focus.messageId);
			return;
		}
		setView("board");
		if (focus.kind === "agent") {
			setFilter({ ...EMPTY_FILTER, agents: new Set([focus.chatId]) });
			return;
		}
		if (filter.chip !== "all" || filter.query) setFilter(EMPTY_FILTER);
		setPendingReveal(questionSelector(focus.chatId));
	});
	useEffect(() => {
		// A request made before the board opened was taken up when its state started.
		clearFocus(rootChatId);
		return useSwarmBoardStore.subscribe((state) => {
			const focus = state.focus[rootChatId];
			if (!focus) return;
			clearFocus(rootChatId);
			applyFocus(focus);
		});
	}, [clearFocus, rootChatId]);

	useEffect(() => {
		if (!pendingReveal) return;
		if (reveal(listRef.current, pendingReveal)) setPendingReveal(null);
	});

	// Read marks: posts at least half seen, in order, move the "seen" mark on.
	useEffect(() => {
		const list = listRef.current;
		if (!list || !visible || filtering || view !== "board" || confirmReset !== null) return;
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
		// Unfolding a post renders its read target anew; watch those too.
		const mutations = new MutationObserver(observeAll);
		mutations.observe(list, { childList: true, subtree: true });
		return () => {
			mutations.disconnect();
			observer.disconnect();
		};
	}, [visible, filtering, view, confirmReset, messages, markSeen, rootChatId]);

	// New posts: follow the bottom when there, else keep the reading position and offer a jump.
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
			if (visible && !filtering && view === "board") list.scrollTop = list.scrollHeight;
			rememberPosition();
			return;
		}
		const ids = new Set(previous.map((message) => message.id));
		const incoming = messages.filter(
			(message) => !ids.has(message.id) && message.timestamp >= (previous.at(-1)?.timestamp ?? 0),
		);
		if (incoming.length > 0 && visible && following.current && !filtering && view === "board") {
			list.scrollTop = list.scrollHeight;
		} else {
			const anchor = readingAnchor.current;
			if (anchor?.element.isConnected && previous !== messages && view === "board")
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

	const reset = async () => {
		if (confirmReset === null) return;
		const revision = confirmReset;
		setConfirmReset(null);
		const outcome = await board.reset(revision);
		track(CHAT_TELEMETRY_EVENTS.swarmBoardReset, { outcome });
		if (outcome === "changed") {
			toast.info("The board changed", {
				description: "New posts arrived. Review them before clearing the board.",
			});
		}
	};

	const copyBoard = () => {
		void copyText(boardMarkdown(shown, nameOf, numbers)).then(
			() => {
				setCopiedBoard(true);
				setTimeout(() => setCopiedBoard(false), 2_000);
			},
			() => toast.error("Could not copy the board"),
		);
	};

	const memberCosts = useMemberCosts(board.team, teamOpen);

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
	const isNew = (message: BoardMessage) =>
		seenAtOpen !== undefined && message.timestamp > seenAtOpen && message.from !== "user";
	const newAtOpen = shown.filter(isNew).length;

	const waitingItems =
		(filter.chip === "all" || filter.chip === "needs-you") && !conversation
			? waiting.map((item) => {
					const member = memberOf(item.chatId === rootChatId ? MAIN : item.chatId);
					const name = member && !member.main ? member.title : "Main agent";
					return (
						<div
							key={`${item.kind}:${item.request.id}`}
							data-needs-you-chat={item.chatId}
							tabIndex={-1}
						>
							<NeedsYouItem
								member={member ?? { title: name, main: true }}
								color={colorOf(member ? boardId(member) : MAIN)}
							>
								{item.kind === "question" ? (
									<OpenCodeQuestionQuestionnaire
										request={item.request}
										submitLabel={`Send to ${name}`}
									/>
								) : (
									<OpenCodePermissionCard request={item.request} acceptOnEnter={false} />
								)}
							</NeedsYouItem>
						</div>
					);
				})
			: [];

	const feed = (): ReactNode[] => {
		let dividerShown = false;
		const items: ReactNode[] = shown.flatMap((message) => {
			const divider = !dividerShown && !filtering && isNew(message);
			if (divider) dividerShown = true;
			return [
				...(divider ? [<NewPostsDivider key="new-divider" count={newAtOpen} />] : []),
				<BoardPost
					key={message.id}
					message={message}
					context={context}
					folded={isFolded(message)}
					foldable={isLong(message.body)}
					onToggle={() => toggle(message)}
					isNew={isNew(message)}
				/>,
			];
		});
		if (!filtering) {
			for (const member of failed)
				items.push(
					<FailedWorker
						key={`failed:${member.chatId}`}
						member={member}
						services={services}
						onOpen={() => openAgent(member.chatId)}
						canOpen={canOpen(member.chatId)}
					/>,
				);
		}
		items.push(...waitingItems);
		if (!filtering) {
			for (const member of working)
				if (!member.main)
					items.push(
						<WorkerWatch
							key={`watch:${member.chatId}`}
							member={member}
							services={services}
							name={member.title}
						/>,
					);
			if (settled && waiting.length === 0)
				items.push(
					<SwarmDoneMarker
						key="done"
						finishedAt={finishedAt}
						agents={workers.length}
						took={finishedAt && Number.isFinite(startedAt) ? finishedAt - startedAt : undefined}
					/>,
				);
		}
		return items;
	};

	const unavailable = board.error !== null && board.feed.revision === null;
	const title = conversation
		? `${nameOf(conversation[0])} ↔ ${nameOf(conversation[1])}`
		: chats?.[rootChatId]?.title || "Delegated work";
	const filteredAgent = !conversation && filter.agents.size === 1 ? [...filter.agents][0]! : null;
	const searchable = !conversation && messages.length >= SEARCH_FROM_POSTS;

	/** A centred note for a board without posts: faces or an icon, what's going on, and a next step. */
	const emptyNote = (media: ReactNode, heading: string, body: string, action?: ReactNode) => (
		<div
			className="flex h-full min-h-56 flex-col items-center justify-center gap-3.5 p-6 text-center"
			data-qa-id="swarm-board-empty"
		>
			{media}
			<p className="text-[15px] leading-[18px] font-medium">{heading}</p>
			<p className="text-muted-foreground max-w-[260px] text-[13px] leading-5">{body}</p>
			{action}
		</div>
	);
	const quietButton = (label: ReactNode, onClick: () => void, qa: string, disabled = false) => (
		<button
			type="button"
			className="ring-foreground/16 hover:bg-muted focus-visible:ring-ring rounded-lg px-3 py-1.5 text-[13px] leading-4 font-medium ring-1 outline-none ring-inset focus-visible:ring-2 disabled:opacity-50"
			disabled={disabled}
			onClick={onClick}
			data-qa-id={qa}
		>
			{label}
		</button>
	);
	const emptyBoard = () => {
		if (working.length > 0) {
			return emptyNote(
				<span className="flex">
					{workers.slice(0, 5).map((member, index) => (
						<span key={member.chatId} className={index > 0 ? "-ms-2" : undefined}>
							<AgentAvatar name={member.title} color={colorOf(member.chatId)} />
						</span>
					))}
				</span>,
				working.length === 1
					? "1 agent is working quietly"
					: `${working.length} agents are working quietly`,
				"Posts appear here when they coordinate or need you. Expand Team above to see what each one is doing.",
				quietButton("Expand team", () => setTeamOpen(true), "swarm-board-empty-members"),
			);
		}
		const icon = <MessageSquareIcon aria-hidden className="text-muted-foreground size-6" />;
		if (settled) {
			return emptyNote(
				icon,
				"No posts on this board",
				`${workers.length === 1 ? "The subagent" : `${workers.length} subagents`} finished without posting. Their reports went to the main agent, in the chat.`,
				quietButton("Go to main chat", openMain, "swarm-board-empty-open-chat", !panes),
			);
		}
		return emptyNote(
			icon,
			"Nothing on the board yet",
			"Agents post findings and questions here as they work.",
		);
	};

	const boardList = (
		<div className="flex min-h-0 flex-1 flex-col">
			{searchable ? (
				<BoardSearch filter={filter} onChange={setFilter} counts={chipCounts} active={visible} />
			) : null}
			{filteredAgent ? (
				<div
					className="flex shrink-0 items-center gap-2 px-5 pt-3 text-xs"
					data-qa-id="swarm-board-agent-filter"
				>
					<span className="text-muted-foreground">Showing posts with</span>
					<span className="bg-muted flex items-center gap-1 rounded-full py-0.5 ps-2 pe-1">
						{nameOf(filteredAgent)}
						<button
							type="button"
							className="hover:bg-accent rounded-full p-0.5"
							aria-label="Show every post"
							onClick={() => setFilter(EMPTY_FILTER)}
							data-qa-id="swarm-board-agent-filter-clear"
						>
							<XIcon aria-hidden className="size-3" />
						</button>
					</span>
				</div>
			) : null}
			<div
				ref={listRef}
				className="min-h-0 flex-1 overflow-y-auto px-5 py-[18px] [overflow-anchor:none]"
				data-qa-id="swarm-board-messages"
				onScroll={(event) => {
					const list = event.currentTarget;
					following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
					rememberPosition();
				}}
				onClick={(event) => {
					const ref = (event.target as HTMLElement).closest<HTMLElement>("[data-post-ref]");
					if (ref) jumpToNumber(Number(ref.dataset.postRef));
				}}
				onKeyDown={(event) => {
					const ref = (event.target as HTMLElement).closest<HTMLElement>("[data-post-ref]");
					if (ref && (event.key === "Enter" || event.key === " ")) {
						event.preventDefault();
						jumpToNumber(Number(ref.dataset.postRef));
					}
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
							Show older posts
						</Button>
					</div>
				) : null}
				{unavailable ? null : messages.length === 0 &&
				  waiting.length === 0 &&
				  failed.length === 0 ? (
					emptyBoard()
				) : filtering && shown.length === 0 && filter.chip !== "needs-you" ? (
					<p
						className="text-muted-foreground py-8 text-center text-sm"
						data-qa-id="swarm-board-no-match"
					>
						No matches in loaded posts.
						{board.feed.hasMore ? " Show older posts to search more." : ""}
					</p>
				) : (
					<ol className="flex flex-col gap-4">{feed()}</ol>
				)}
			</div>
			{arrivals.length > 0 ? (
				<div className="flex shrink-0 justify-center pb-3">
					<button
						type="button"
						className="bg-foreground text-background focus-visible:ring-ring flex items-center gap-1 rounded-full px-3 py-[5px] text-xs font-medium outline-none focus-visible:ring-2"
						data-qa-id="swarm-board-new-messages"
						onClick={() => jumpTo(arrivals[0]!)}
					>
						<ArrowDownIcon aria-hidden className="size-3" />
						{arrivals.length} more new {arrivals.length === 1 ? "post" : "posts"}
					</button>
				</div>
			) : null}
		</div>
	);

	const graphMembers: GraphMember[] = board.team.map((member) => ({
		id: boardId(member),
		name: member.main ? "Main agent" : member.title,
		color: colorOf(member.chatId),
		done: !member.main && !isActive(member.state),
	}));
	const graphPosts: GraphPost[] = messages.map((message) => ({
		id: message.id,
		seq: numbers.get(message.id) ?? 0,
		from: message.from === rootChatId ? MAIN : message.from,
		to: message.to === rootChatId ? MAIN : message.to,
		type: message.type,
		timestamp: message.timestamp,
	}));

	return (
		<div className="bg-pane flex h-full min-h-0 flex-col overflow-hidden" data-qa-id="swarm-board">
			<header className="flex shrink-0 items-center gap-2 ps-5 pe-4 pt-3.5 pb-2.5">
				<span className="text-muted-foreground shrink-0 text-[13px] leading-4">
					{conversation ? "Conversation in" : "Swarm for"}
				</span>
				<button
					type="button"
					className="bg-foreground/[0.06] ring-foreground/10 hover:bg-foreground/10 focus-visible:ring-ring flex min-w-0 items-center gap-1.5 rounded-lg py-1 ps-[7px] pe-[9px] ring-1 outline-none ring-inset focus-visible:ring-2 disabled:pointer-events-none"
					disabled={!panes}
					onClick={openMain}
					aria-label={`Go to main chat: ${chats?.[rootChatId]?.title || "Delegated work"}`}
					data-qa-id="swarm-board-chat"
				>
					<MessageSquareIcon aria-hidden className="text-muted-foreground size-[13px] shrink-0" />
					<span className="truncate text-[13px] leading-4 font-semibold">
						{chats?.[rootChatId]?.title || "Delegated work"}
					</span>
					<ArrowUpRightIcon aria-hidden className="text-muted-foreground size-[11px] shrink-0" />
				</button>
				<span className="flex-1" />
				<StatusPill board={board} finishedAt={finishedAt} />
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								className="bg-foreground/10 size-[26px] rounded-md"
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
								disabled={!panes}
								onClick={openMain}
								data-qa-id="swarm-board-open-chat"
							>
								<ArrowUpRightIcon />
								Go to main chat
							</DropdownMenuItem>
							<DropdownMenuItem
								data-qa-id="swarm-board-copy"
								disabled={shown.length === 0}
								onClick={copyBoard}
							>
								{copiedBoard ? <CheckIcon /> : <ClipboardCopyIcon />}
								{filtering ? "Copy shown posts as Markdown" : "Copy board as Markdown"}
							</DropdownMenuItem>
							{conversation ? null : (
								<DropdownMenuItem
									disabled={messages.length === 0}
									onClick={() => setView(view === "graph" ? "board" : "graph")}
									data-qa-id="swarm-board-graph"
								>
									<WaypointsIcon />
									{view === "graph" ? "Back to the board" : "Who talks to whom"}
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
						{conversation ? null : (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuGroup>
									<DropdownMenuItem
										disabled={!workers.some((member) => member.jobId)}
										onClick={() => setConfirmStopAll(true)}
										data-qa-id="swarm-board-stop-all"
									>
										<SquareIcon />
										Stop all agents
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
										Clear board…
									</DropdownMenuItem>
								</DropdownMenuGroup>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</header>
			{unavailable ? (
				<Empty className="shrink-0 py-4" data-qa-id="swarm-board-unavailable">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessagesSquareIcon />
						</EmptyMedia>
						<EmptyTitle>The board isn't available for this chat</EmptyTitle>
						<EmptyDescription>
							The board could not be loaded; this chat may not support Kilo Swarm.
						</EmptyDescription>
						<p className="text-muted-foreground/70 mt-1 text-xs">{board.error}</p>
					</EmptyHeader>
					<EmptyContent>
						<Button size="sm" variant="outline" onClick={board.refresh}>
							Try again
						</Button>
					</EmptyContent>
				</Empty>
			) : board.error ? (
				<Alert
					variant="destructive"
					className="mx-4 w-auto shrink-0"
					data-qa-id="swarm-board-error"
				>
					<CircleAlertIcon />
					<AlertTitle>Board update incomplete</AlertTitle>
					<AlertDescription>{board.error}</AlertDescription>
				</Alert>
			) : null}
			{conversation ? (
				<div
					className="flex h-9 shrink-0 items-center gap-2 border-b ps-6 pe-5 text-xs font-medium"
					data-qa-id="swarm-board-title"
				>
					{title}
				</div>
			) : (
				<>
					<button
						type="button"
						className="hover:bg-muted/50 focus-visible:ring-ring flex h-9 shrink-0 items-center gap-2 border-b ps-6 pe-5 text-start text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset"
						aria-expanded={teamOpen}
						onClick={() => setTeamOpen(!teamOpen)}
						data-qa-id="swarm-team-toggle"
					>
						<span className="font-medium">Team</span>
						<TeamSummary team={board.team} />
						<span className="flex-1" />
						<ChevronDownIcon
							aria-hidden
							className={cn(
								"text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
								teamOpen && "rotate-180",
							)}
						/>
					</button>
					{teamOpen ? (
						<div
							className="max-h-[55%] shrink-0 overflow-y-auto border-b px-4 py-3"
							data-qa-id="swarm-team"
						>
							<MembersView
								team={board.team}
								rootChatId={rootChatId}
								services={services}
								colorOf={colorOf}
								messages={messages}
								numbers={numbers}
								directoryOf={(chatId) => chats?.[chatId]?.directory ?? undefined}
								updatedAtOf={(chatId) => chats?.[chatId]?.updatedAt}
								costOf={memberCosts}
								onOpen={openAgent}
								canOpen={canOpen}
								onShowPosts={(chatId) => {
									setFilter({ ...EMPTY_FILTER, agents: new Set([chatId]) });
									setTeamOpen(false);
									setView("board");
								}}
								onOpenConversation={openConversation}
								onShowQuestion={(chatId) => {
									setTeamOpen(false);
									setView("board");
									setPendingReveal(questionSelector(chatId));
								}}
								onStop={stop}
							/>
						</div>
					) : null}
				</>
			)}
			{view === "graph" && !conversation ? (
				<div
					className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
					data-qa-id="swarm-board-graph-view"
				>
					<div className="mb-3 flex items-center justify-between gap-2">
						<h3 className="text-[13px] font-semibold">Who talks to whom</h3>
						<Button
							size="xs"
							variant="ghost"
							className="text-muted-foreground"
							onClick={() => setView("board")}
							data-qa-id="swarm-board-graph-back"
						>
							Back to the board
						</Button>
					</div>
					<SwarmGraph
						members={graphMembers}
						posts={graphPosts}
						onFilter={(id) => {
							setFilter({ ...EMPTY_FILTER, agents: new Set([id]) });
							setView("board");
						}}
						onOpen={openAgent}
					/>
				</div>
			) : (
				boardList
			)}
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
							Removes the board's posts for every agent. Conversations and running work are not
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
			<AlertDialog open={confirmStopAll} onOpenChange={setConfirmStopAll}>
				<AlertDialogContent data-qa-id="swarm-board-stop-all-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Stop all agents?</AlertDialogTitle>
						<AlertDialogDescription>
							Every running subagent stops now. Work they already saved stays; the main agent is
							told they were stopped.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							data-qa-id="swarm-board-stop-all-confirm"
							onClick={stopAll}
						>
							Stop all
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
