import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";

/** The main agent's color: neutral, so the workers' colors stand out. */
export const MAIN_AGENT_COLOR = "#64748B";

/** Workers' colors, in the order they joined the team; readable on light and dark panes. */
export const WORKER_COLORS = [
	"#6366F1",
	"#10B981",
	"#F59E0B",
	"#EC4899",
	"#06B6D4",
	"#8B5CF6",
	"#EF4444",
	"#84CC16",
] as const;

/** Kilo's board name for the root chat. */
const MAIN = "main";

/** The root of a chat's team: its topmost ancestor kilo.core lists. */
export function teamRootOf(chatId: string, chats: Readonly<Record<string, ChatSummary>>): string {
	let id = chatId;
	for (let depth = 0; depth < 16; depth += 1) {
		const parent = chats[id]?.parentId;
		if (!parent || !chats[parent]) return id;
		id = parent;
	}
	return id;
}

/** A team member Kilo's roster lists, with when its chat started. */
export interface RosterEntry {
	readonly chatId: string;
	readonly startedAt: number;
}

/**
 * Each team member's color: the main agent's, then the workers' in the order
 * their chats started (from kilo.core's chats and Kilo's roster alike, which
 * share the chat's creation time), so the board, its roster and a worker's
 * own pane agree whichever of the two each has.
 */
export function teamColors(
	rootChatId: string,
	chats: Readonly<Record<string, ChatSummary>>,
	roster: readonly RosterEntry[] = [],
): ReadonlyMap<string, string> {
	const below = (chat: ChatSummary): boolean => {
		for (let parent = chat.parentId, depth = 0; parent && depth < 16; depth += 1) {
			if (parent === rootChatId) return true;
			parent = chats[parent]?.parentId ?? null;
		}
		return false;
	};
	const started = new Map<string, number>();
	for (const chat of Object.values(chats)) if (below(chat)) started.set(chat.id, chat.createdAt);
	for (const entry of roster) {
		if (entry.chatId !== rootChatId && !started.has(entry.chatId))
			started.set(entry.chatId, entry.startedAt);
	}
	const ordered = [...started]
		.toSorted(([a, at], [b, bt]) => at - bt || a.localeCompare(b))
		.map(([id]) => id);
	return new Map<string, string>([
		[rootChatId, MAIN_AGENT_COLOR],
		[MAIN, MAIN_AGENT_COLOR],
		...ordered.map((id, index) => [id, WORKER_COLORS[index % WORKER_COLORS.length]!] as const),
	]);
}

/** A soft fill of `color` behind content in the theme's text color. */
export const tint = (color: string, percent = 14) =>
	`color-mix(in srgb, ${color} ${percent}%, transparent)`;
