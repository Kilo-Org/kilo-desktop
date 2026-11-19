import {
	BOARD_MESSAGE_TYPES,
	type BoardMessage,
	type BoardMessageType,
} from "@kilo-desktop/plugin-core/contracts";

/** Kilo's board names for the root chat and for the person. */
const MAIN = "main";
const USER = "user";

/** Types where the absence of a reply is useful to surface, without inferring resolution. */
const AWAITING: ReadonlySet<BoardMessageType> = new Set(["ASK", "HOLD", "VETO"]);

/**
 * Loaded ASKs, HOLDs and VETOs without a loaded direct reply.
 * A reply is not proof that a request was answered or a concern resolved.
 */
export function openQuestions(messages: readonly BoardMessage[]): ReadonlySet<string> {
	const repliedTo = new Set(
		messages.flatMap((message) => (message.replyTo ? [message.replyTo] : [])),
	);
	return new Set(
		messages
			.filter((message) => AWAITING.has(message.type) && !repliedTo.has(message.id))
			.map((message) => message.id),
	);
}

/** Each agent's newest loaded RESULT, in the order the agents first reported one. */
export function latestResults(messages: readonly BoardMessage[]): BoardMessage[] {
	const latest = new Map<string, BoardMessage>();
	for (const message of messages) {
		if (message.type === "RESULT" && message.from !== USER) latest.set(message.from, message);
	}
	return [...latest.values()].toSorted(
		(a, b) => firstResultAt(messages, a.from) - firstResultAt(messages, b.from),
	);
}

function firstResultAt(messages: readonly BoardMessage[], from: string): number {
	return (
		messages.find((message) => message.type === "RESULT" && message.from === from)?.timestamp ?? 0
	);
}

/** `between`: posts from one selected agent to another. */
export type FilterDirection = "from" | "to" | "both" | "between";

/** What the board shows: everything, unless the person narrowed it. */
export interface BoardFilter {
	/** Team members by chat id (`main` for the main agent); empty is everyone. */
	readonly agents: ReadonlySet<string>;
	readonly direction: FilterDirection;
	/** Empty is every type. */
	readonly types: ReadonlySet<BoardMessageType>;
	/** Only ASKs, HOLDs and VETOs without a loaded reply. */
	readonly openOnly: boolean;
	readonly query: string;
}

export const EMPTY_FILTER: BoardFilter = {
	agents: new Set(),
	direction: "both",
	types: new Set(),
	openOnly: false,
	query: "",
};

export const isFiltering = (filter: BoardFilter) =>
	filter.agents.size > 0 || filter.types.size > 0 || filter.openOnly || filter.query.trim() !== "";

/**
 * The posts the filter lets through. `mainChatId` is the root chat, which
 * the board calls `main`.
 */
export function filterMessages(
	messages: readonly BoardMessage[],
	filter: BoardFilter,
	mainChatId?: string,
): BoardMessage[] {
	if (!isFiltering(filter)) return [...messages];
	const open = filter.openOnly ? openQuestions(messages) : undefined;
	const query = filter.query.trim().toLowerCase();
	const agents = new Set([...filter.agents].map((id) => (id === mainChatId ? MAIN : id)));
	return messages.filter((message) => {
		if (filter.types.size > 0 && !filter.types.has(message.type)) return false;
		if (open && !open.has(message.id)) return false;
		if (query && !message.body.toLowerCase().includes(query)) return false;
		if (agents.size === 0) return true;
		const from = agents.has(message.from);
		const to = agents.has(message.to);
		switch (filter.direction) {
			case "from":
				return from;
			case "to":
				return to;
			case "between":
				return from && to;
			default:
				return from || to;
		}
	});
}

export function typeCounts(messages: readonly BoardMessage[]): Record<BoardMessageType, number> {
	const counts = Object.fromEntries(BOARD_MESSAGE_TYPES.map((type) => [type, 0])) as Record<
		BoardMessageType,
		number
	>;
	for (const message of messages) counts[message.type] += 1;
	return counts;
}

/** A post and every reply below it (replies to replies included), in time order. */
export interface BoardThread {
	readonly root: BoardMessage;
	readonly replies: readonly BoardMessage[];
	/** It replies to a post no longer on the loaded pages. */
	readonly orphan: boolean;
}

export function threadsOf(messages: readonly BoardMessage[]): BoardThread[] {
	const byId = new Map(messages.map((message) => [message.id, message]));
	const rootOf = (message: BoardMessage): BoardMessage => {
		let current = message;
		for (let depth = 0; depth < 64 && current.replyTo; depth += 1) {
			const parent = byId.get(current.replyTo);
			if (!parent) break;
			current = parent;
		}
		return current;
	};
	const threads = new Map<string, { root: BoardMessage; replies: BoardMessage[] }>();
	for (const message of messages) {
		const root = rootOf(message);
		const thread = threads.get(root.id) ?? { root, replies: [] };
		if (root.id !== message.id) thread.replies.push(message);
		threads.set(root.id, thread);
	}
	return [...threads.values()].map(({ root, replies }) => ({
		root,
		replies,
		orphan: root.replyTo !== undefined && !byId.has(root.replyTo),
	}));
}

/** Agents' posts after `seenAt` (all of them when the board was never looked at). */
export function unreadCount(
	messages: readonly Pick<BoardMessage, "from" | "timestamp">[],
	seenAt: number | undefined,
): number {
	return messages.filter(
		(message) => message.from !== USER && (seenAt === undefined || message.timestamp > seenAt),
	).length;
}

/** Posts as markdown, for pasting into a PR or a message. */
export function boardMarkdown(
	messages: readonly BoardMessage[],
	nameOf: (id: string, label?: string) => string,
): string {
	return messages
		.map((message) => {
			const when = new Date(message.timestamp).toLocaleString();
			const route = `${nameOf(message.from, message.fromLabel)} → ${nameOf(message.to, message.toLabel)}`;
			return `**${route}** · ${message.type} · ${when}\n\n${message.body}`;
		})
		.join("\n\n---\n\n");
}
