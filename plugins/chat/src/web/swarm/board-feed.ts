import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";

/** The board as the pane holds it: every page read so far, oldest first. */
export interface BoardFeed {
	readonly ownerChatId: string | null;
	readonly revision: number | null;
	readonly messages: readonly BoardMessage[];
	/** Whether older messages remain beyond `cursor`. */
	readonly hasMore: boolean;
	readonly cursor?: string;
}

export const EMPTY_FEED: BoardFeed = {
	ownerChatId: null,
	revision: null,
	messages: [],
	hasMore: false,
};

function fresh(board: SwarmBoard): BoardFeed {
	return {
		ownerChatId: board.ownerChatId,
		revision: board.revision,
		messages: board.messages,
		hasMore: board.hasMore,
		...(board.cursor ? { cursor: board.cursor } : {}),
	};
}

/**
 * The newest page read again. Older pages already read are kept when the
 * page overlaps them; otherwise (a reset, or more new posts than a page
 * holds) the feed starts over from this page.
 */
export function mergeNewest(feed: BoardFeed, board: SwarmBoard): BoardFeed {
	const oldestNew = board.messages[0];
	const overlap = oldestNew
		? feed.messages.findIndex((message) => message.id === oldestNew.id)
		: -1;
	if (feed.revision === null || overlap < 0) return fresh(board);
	return {
		...feed,
		ownerChatId: board.ownerChatId,
		revision: board.revision,
		messages: [...feed.messages.slice(0, overlap), ...board.messages],
	};
}

/** An older page, read with the feed's cursor, in front of what it holds. */
export function mergeOlder(feed: BoardFeed, board: SwarmBoard): BoardFeed {
	const held = new Set(feed.messages.map((message) => message.id));
	const { cursor: _previous, ...rest } = feed;
	return {
		...rest,
		messages: [...board.messages.filter((message) => !held.has(message.id)), ...feed.messages],
		hasMore: board.hasMore,
		...(board.cursor ? { cursor: board.cursor } : {}),
	};
}
