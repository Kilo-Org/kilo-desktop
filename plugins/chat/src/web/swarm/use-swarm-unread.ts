import { useEffect, useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Swarm, SWARM_BOARD_PAGE_LIMIT } from "@kilo-desktop/plugin-core/contracts";

import { unreadCount } from "./board-insights";
import { useSwarmBoardStore } from "./swarm-board-store";

/**
 * How many agents' posts on a root chat's board the person hasn't seen, for
 * the composer's Board button. The newest page is read when `trigger`
 * changes (a subagent started or finished) and when Kilo announces a
 * change — not on a timer — so it costs one small read per team event.
 * Up to a page's worth is counted ("50+" past that is the caller's call).
 */
export function useSwarmUnread(rootChatId: string | null, trigger: string): number {
	const swarm = useDomainObject(Swarm);
	const seenAt = useSwarmBoardStore((state) => (rootChatId ? state.seen[rootChatId] : undefined));
	const [timestamps, setTimestamps] = useState<readonly PostStamp[]>([]);

	useEffect(
		() => watchNewestPage(swarm, rootChatId, trigger, setTimestamps),
		[rootChatId, swarm, trigger],
	);

	return unreadCount(timestamps, seenAt);
}

interface PostStamp {
	readonly from: string;
	readonly timestamp: number;
}

/**
 * Reads the board's newest page now and whenever Kilo announces a change,
 * until the returned cleanup runs. `_trigger` is the team event that re-runs it.
 */
function watchNewestPage(
	swarm: DomainObjectHandle<typeof Swarm> | null,
	rootChatId: string | null,
	_trigger: string,
	onPage: (stamps: readonly PostStamp[]) => void,
): (() => void) | undefined {
	if (!swarm || !rootChatId) return;
	let live = true;
	const read = () =>
		void swarm.methods
			.board({ chatId: rootChatId, limit: SWARM_BOARD_PAGE_LIMIT })
			.then((board) => {
				if (live) onPage(board.messages.map(({ from, timestamp }) => ({ from, timestamp })));
			})
			.catch(() => undefined);
	read();
	const stop = swarm.on("board-updated", ({ chatId }) => {
		if (chatId === rootChatId) read();
	});
	return () => {
		live = false;
		stop();
	};
}
