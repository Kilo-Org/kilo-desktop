import { useEffect, useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import {
	Swarm,
	SWARM_BOARD_PAGE_LIMIT,
	type SwarmBoard,
} from "@kilo-desktop/plugin-core/contracts";

/** Where a post sits: the root chat owning its board and, when found, its number (`#n`). */
export interface BoardPostPlace {
	readonly rootChatId: string;
	readonly number?: number;
}

/**
 * The post's number on the board, when the page holds it. Kilo numbers posts
 * with no gaps and only a reset removes any, so the page (the newest posts,
 * oldest first) counts down from the board's revision.
 */
export function postNumberIn(board: SwarmBoard, messageId: string): number | undefined {
	const index = board.messages.findIndex((message) => message.id === messageId);
	if (index < 0) return undefined;
	return board.revision - (board.messages.length - 1 - index);
}

/** Numbered posts by id: a post's number never changes, so it is read once. */
const places = new Map<string, BoardPostPlace>();
/** Board reads in flight by chat, so a transcript's posts share one read. */
const reads = new Map<string, Promise<SwarmBoard | null>>();

function readBoard(
	swarm: DomainObjectHandle<typeof Swarm>,
	chatId: string,
): Promise<SwarmBoard | null> {
	const pending = reads.get(chatId);
	if (pending) return pending;
	const read: Promise<SwarmBoard | null> = swarm.methods
		.board({ chatId, limit: SWARM_BOARD_PAGE_LIMIT })
		.catch(() => null)
		.finally(() => {
			if (reads.get(chatId) === read) reads.delete(chatId);
		});
	reads.set(chatId, read);
	return read;
}

/**
 * Finds a post on the board of `chatId`'s team (Kilo routes any chat of the
 * tree to its root's board); null when the board can't be read.
 */
export async function findBoardPost(
	swarm: DomainObjectHandle<typeof Swarm>,
	chatId: string,
	messageId: string,
): Promise<BoardPostPlace | null> {
	const known = places.get(messageId);
	if (known) return known;
	const board = await readBoard(swarm, chatId);
	if (!board) return null;
	const number = postNumberIn(board, messageId);
	const place: BoardPostPlace = {
		rootChatId: board.ownerChatId,
		...(number === undefined ? {} : { number }),
	};
	if (number !== undefined) places.set(messageId, place);
	return place;
}

/** {@link findBoardPost} for a component; null until (or unless) the board says. */
export function useBoardPostPlace(
	chatId: string | undefined,
	messageId: string | undefined,
): BoardPostPlace | null {
	const swarm = useDomainObject(Swarm);
	const [found, setFound] = useState<{ key: string; place: BoardPostPlace | null } | null>(null);
	useEffect(() => {
		if (!swarm || !chatId || !messageId) return;
		let live = true;
		void findBoardPost(swarm, chatId, messageId).then((place) => {
			if (live) setFound({ key: `${chatId}\n${messageId}`, place });
		});
		return () => {
			live = false;
		};
	}, [chatId, messageId, swarm]);
	return chatId && messageId && found?.key === `${chatId}\n${messageId}` ? found.place : null;
}
