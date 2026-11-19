import {
	BOARD_EVERYONE,
	type BackgroundJob,
	type ChatSummary,
	type SwarmTeam,
} from "@kilo-desktop/plugin-core/contracts";

/** Kilo's board name for the root chat. */
const MAIN = "main";
/** Kilo's board name for the person (a message they sent a worker, mirrored by Kilo). */
const USER = "user";

/**
 * What a team member is doing, one per Kilo state (running and busy look
 * alike): `idle` is the main agent between turns; `stopped` a worker a
 * restart cut off; `unknown` a worker nothing says anything about.
 */
export type MemberState =
	| "working"
	| "retrying"
	| "idle"
	| "done"
	| "failed"
	| "cancelled"
	| "stopped"
	| "unknown";

/** One agent of a root chat's team: the root itself or a subagent below it. */
export interface TeamMember {
	readonly chatId: string;
	/** The worker's actual delegating chat, which can be another worker. */
	readonly parentChatId?: string;
	readonly title: string;
	/** True for the root chat (the main agent). */
	readonly main: boolean;
	readonly state: MemberState;
	/** It waits for the person: a question or a permission prompt. */
	readonly needsYou: boolean;
	readonly attention?: readonly ("permission" | "question")[];
	/** Its agent type (`explore`, `general`…). */
	readonly agent?: string;
	/** The model it runs on, `<aiProviderId>/<modelId>`. */
	readonly model?: string;
	/** It runs as a background job (the main agent doesn't wait for it); absent when nothing says. */
	readonly background?: boolean;
	/** The running background job, which can be stopped. */
	readonly jobId?: string;
	readonly startedAt?: number;
	readonly completedAt?: number;
	readonly error?: string;
}

/** Kilo names a task's chat "… (@explore subagent)"; the row shows the agent on its own. */
export function displayTitle(title: string): string {
	return title.replace(/\s*\(@[\w-]+ subagent\)\s*$/, "") || title;
}

const JOB_STATE: Record<BackgroundJob["status"], MemberState> = {
	running: "working",
	completed: "done",
	error: "failed",
	cancelled: "cancelled",
};

const ROSTER_STATE: Record<SwarmTeam["members"][number]["state"], MemberState> = {
	running: "working",
	busy: "working",
	retry: "retrying",
	completed: "done",
	error: "failed",
	cancelled: "cancelled",
	offline: "stopped",
	unknown: "unknown",
};

function attentionReasons(chat: ChatSummary | undefined): ("permission" | "question")[] {
	const attention: ("permission" | "question")[] = [];
	if (chat?.activity.pendingPermissionIds.length) attention.push("permission");
	if (chat?.activity.pendingQuestionIds.length) attention.push("question");
	return attention;
}

/** What kilo.core's live activity says, when it says anything definite. */
function liveState(chat: ChatSummary | undefined): MemberState | undefined {
	if (chat?.activity.status === "busy") return "working";
	if (chat?.activity.status === "retry") return "retrying";
	return undefined;
}

/**
 * A worker's state from what kilo.core and its background job say: live
 * activity first, then the job's outcome, then the last turn the app watched.
 */
function workerState(chat: ChatSummary, job: BackgroundJob | undefined): MemberState {
	const live = liveState(chat);
	if (live) return live;
	if (job) return JOB_STATE[job.status];
	if (chat.activity.lastError) return "failed";
	if (chat.activity.completedAt !== undefined) return "done";
	return "unknown";
}

function mainMember(root: ChatSummary): TeamMember {
	const attention = attentionReasons(root);
	const state = liveState(root) ?? (root.activity.lastError ? "failed" : "idle");
	return {
		chatId: root.id,
		title: root.title,
		main: true,
		state,
		needsYou: attention.length > 0,
		attention,
		background: false,
		startedAt: root.createdAt,
		...(root.activity.completedAt !== undefined && !isActive(state)
			? { completedAt: root.activity.completedAt }
			: {}),
		...(root.activity.lastError ? { error: root.activity.lastError.message } : {}),
	};
}

/**
 * The root chat and every chat delegated below it (breadth first, each
 * generation in the order it started), as the board's roster shows them.
 */
export function swarmTeam(
	rootChatId: string,
	chats: Readonly<Record<string, ChatSummary>>,
	jobs: readonly BackgroundJob[],
): TeamMember[] {
	const root = chats[rootChatId];
	if (!root) return [];
	const children = new Map<string, ChatSummary[]>();
	for (const chat of Object.values(chats)) {
		if (!chat.parentId) continue;
		children.set(chat.parentId, [...(children.get(chat.parentId) ?? []), chat]);
	}
	const jobByChat = new Map(
		jobs.flatMap((job) => (job.chatId ? [[job.chatId, job] as const] : [])),
	);
	const workers: ChatSummary[] = [];
	let generation = children.get(root.id) ?? [];
	while (generation.length > 0) {
		const sorted = generation.toSorted((a, b) => a.createdAt - b.createdAt);
		workers.push(...sorted);
		generation = sorted.flatMap((chat) => children.get(chat.id) ?? []);
	}
	return [
		mainMember(root),
		...workers.map((chat): TeamMember => {
			const job = jobByChat.get(chat.id);
			const agent = chat.agent ?? job?.agent;
			const completedAt = job?.completedAt ?? chat.activity.completedAt;
			const error = job?.error ?? chat.activity.lastError?.message;
			const state = workerState(chat, job);
			const attention = attentionReasons(chat);
			return {
				chatId: chat.id,
				...(chat.parentId ? { parentChatId: chat.parentId } : {}),
				title: displayTitle(chat.title),
				main: false,
				state,
				needsYou: attention.length > 0,
				attention,
				background: job !== undefined,
				startedAt: job?.startedAt || chat.createdAt,
				...(agent ? { agent } : {}),
				...(job?.model ? { model: job.model } : {}),
				...(job?.status === "running" ? { jobId: job.id } : {}),
				...(completedAt !== undefined && !isActive(state) ? { completedAt } : {}),
				...(error && state === "failed" ? { error } : {}),
			};
		}),
	];
}

/**
 * The team from Kilo's roster: the root chat first, then the workers in the
 * order Kilo lists them (working first). It knows every worker, its agent
 * and model; kilo.core's live activity still
 * wins for state, since the roster is read less often.
 */
export function rosterTeam(
	rootChatId: string,
	chats: Readonly<Record<string, ChatSummary>>,
	roster: SwarmTeam,
	jobs: readonly BackgroundJob[],
): TeamMember[] {
	const root = chats[rootChatId];
	const liveJobs = new Set(jobs.filter((job) => job.status === "running").map((job) => job.id));
	return [
		...(root ? [mainMember(root)] : []),
		...roster.members.map((member): TeamMember => {
			const chat = chats[member.chatId];
			const state = liveState(chat) ?? ROSTER_STATE[member.state];
			const agent = member.agent ?? chat?.agent;
			const attention = [...new Set([...member.attention, ...attentionReasons(chat)])];
			return {
				chatId: member.chatId,
				parentChatId: chat?.parentId ?? member.parentChatId,
				title: displayTitle(member.title),
				main: false,
				state,
				needsYou: attention.length > 0,
				attention,
				...(member.background !== undefined ? { background: member.background } : {}),
				startedAt: member.startedAt,
				...(agent ? { agent } : {}),
				...(member.model ? { model: member.model } : {}),
				// Kilo names a background job by its worker's chat.
				...(member.live || liveJobs.has(member.chatId) ? { jobId: member.chatId } : {}),
				...(member.completedAt !== undefined && !isActive(state)
					? { completedAt: member.completedAt }
					: {}),
				...(member.error && state === "failed" ? { error: member.error } : {}),
			};
		}),
	];
}

export const isActive = (state: MemberState) => state === "working" || state === "retrying";

/** While anyone works the board may change, so the pane keeps reading it. */
export function teamIsWorking(
	team: readonly TeamMember[],
	jobs: readonly BackgroundJob[],
): boolean {
	return (
		team.some((member) => isActive(member.state)) || jobs.some((job) => job.status === "running")
	);
}

/** How the board names a sender or recipient: by the team member's title when known. */
export function participantName(
	id: string,
	kiloLabel: string | undefined,
	team: readonly TeamMember[],
): string {
	if (id === BOARD_EVERYONE) return "Everyone";
	if (id === USER) return "You";
	const member = team.find((candidate) => candidate.chatId === id);
	if (id === MAIN || member?.main) return "Main agent";
	return member?.title ?? kiloLabel ?? "A finished agent";
}
