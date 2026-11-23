import type { BoardMessage, BoardMessageType } from "@kilo-desktop/plugin-core/contracts";

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

/** `between`: posts from one selected agent to another. */
export type FilterDirection = "from" | "to" | "both" | "between";

/**
 * The board's quick views: everything; only what waits on the person (their
 * questions and permission prompts, which aren't posts); posts that block
 * someone (HOLD, VETO); posts addressed to the person.
 */
export const BOARD_CHIPS = ["all", "needs-you", "blocking", "mentions"] as const;
export type BoardChip = (typeof BOARD_CHIPS)[number];

/** What the board shows: everything, unless the person narrowed it. */
export interface BoardFilter {
	/** Team members by chat id (`main` for the main agent); empty is everyone. */
	readonly agents: ReadonlySet<string>;
	readonly direction: FilterDirection;
	readonly chip: BoardChip;
	/** Matches bodies, agent names, or a post number written `#n`. */
	readonly query: string;
}

export const EMPTY_FILTER: BoardFilter = {
	agents: new Set(),
	direction: "both",
	chip: "all",
	query: "",
};

export const isFiltering = (filter: BoardFilter) =>
	filter.agents.size > 0 || filter.chip !== "all" || filter.query.trim() !== "";

export const isBlocking = (message: Pick<BoardMessage, "type">) =>
	message.type === "HOLD" || message.type === "VETO";

export interface FilterOptions {
	/** The root chat, which the board calls `main`. */
	readonly mainChatId?: string;
	readonly nameOf?: (id: string, label?: string) => string;
	/** Each post's `#n`. */
	readonly numbers?: ReadonlyMap<string, number>;
}

/** The posts the filter lets through. */
export function filterMessages(
	messages: readonly BoardMessage[],
	filter: BoardFilter,
	options: FilterOptions = {},
): BoardMessage[] {
	if (!isFiltering(filter)) return [...messages];
	if (filter.chip === "needs-you") return [];
	const query = filter.query.trim().toLowerCase();
	const number = /^#(\d+)$/.exec(query)?.[1];
	const agents = new Set([...filter.agents].map((id) => (id === options.mainChatId ? MAIN : id)));
	const matches = (message: BoardMessage) => {
		if (!query) return true;
		if (number !== undefined) return options.numbers?.get(message.id) === Number(number);
		const names = options.nameOf
			? [
					options.nameOf(message.from, message.fromLabel),
					options.nameOf(message.to, message.toLabel),
				]
			: [];
		return [message.body, ...names].some((text) => text.toLowerCase().includes(query));
	};
	return messages.filter((message) => {
		if (filter.chip === "blocking" && !isBlocking(message)) return false;
		if (filter.chip === "mentions" && message.to !== USER) return false;
		if (!matches(message)) return false;
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
	numbers: ReadonlyMap<string, number> = new Map(),
): string {
	return messages
		.map((message) => {
			const when = new Date(message.timestamp).toLocaleString();
			const route = `${nameOf(message.from, message.fromLabel)} → ${nameOf(message.to, message.toLabel)}`;
			const number = numbers.get(message.id);
			return `**${route}** · ${number !== undefined ? `#${number} · ` : ""}${message.type} · ${when}\n\n${message.body}`;
		})
		.join("\n\n---\n\n");
}
