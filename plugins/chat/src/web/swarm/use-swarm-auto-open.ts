import { useEffect } from "react";

import { autoOpenThreshold, useSwarmPreferences } from "./swarm-preferences";
import type { OpenSwarmBoard } from "./use-open-swarm-board";

/** Root chats whose board already opened by itself in this window, so closing it doesn't bring it back. */
const autoOpened = new Set<string>();

/**
 * Opens a root chat's Swarm Board beside the chat, without taking focus, once
 * its delegations reach the person's threshold (Settings → Swarm Board)
 * while one of them still works — a finished swarm in an old chat stays shut.
 * At most once per root chat while the window lives.
 */
export function useSwarmAutoOpen(
	board: OpenSwarmBoard | null,
	delegations: number,
	working: number,
): void {
	const threshold = autoOpenThreshold(useSwarmPreferences((state) => state.autoOpen));
	const due = board !== null && threshold !== null && delegations >= threshold && working > 0;
	useEffect(() => {
		if (!due || !board || autoOpened.has(board.rootChatId)) return;
		autoOpened.add(board.rootChatId);
		board.open({ activate: false });
	}, [board, due]);
}
