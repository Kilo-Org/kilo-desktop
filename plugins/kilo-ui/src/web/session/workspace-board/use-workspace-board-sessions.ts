import { useAui, useAuiState } from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { navigateToChat } from "../../chat/chat-navigation.js";
import { useSessionActivity } from "../activity/SessionActivityProvider.js";
import { withDescendantPrompts } from "../activity/session-activity-logic.js";
import { useSessions } from "../SessionsProvider.js";
import { buildBoardSessions, type BoardSession } from "./workspace-board-sessions.js";
import { followBoardCards, WORKSPACE_BOARD_OPEN_SESSION_EVENT } from "./workspace-board-window.js";
import { useWorkspaceBoard } from "./WorkspaceBoardProvider.js";

/** Loaded sessions with their chat's live activity, keyed by session id. */
export function useWorkspaceBoardSessions(): ReadonlyMap<string, BoardSession> {
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const activityBySessionId = useSessionActivity((s) => withDescendantPrompts(s.sessions));
	const lastVisitedAtBySessionId = useSessionActivity((s) => s.lastVisitedAtBySessionId);
	const sessionIdByChat = useSessions((s) => s.sessionIdByChat);
	return useMemo(
		() =>
			buildBoardSessions({
				threadItems,
				sessionIdByChat,
				activityBySessionId,
				lastVisitedAtBySessionId,
			}),
		[activityBySessionId, lastVisitedAtBySessionId, sessionIdByChat, threadItems],
	);
}

/** The popped-out board's chats: the main window's, as it publishes them. */
export function useMainWindowBoardSessions(): ReadonlyMap<string, BoardSession> {
	const sdk = useSdk("kilo-ui");
	const [sessions, setSessions] = useState<ReadonlyMap<string, BoardSession>>(() => new Map());
	useEffect(
		() =>
			followBoardCards(sdk.events, (cards) =>
				setSessions(new Map(cards.map((card) => [card.sessionId, card]))),
			),
		[sdk],
	);
	return sessions;
}

/**
 * Switches this window's chat runtime to the chat and shows the chat page.
 * Takes a thread id or a Kilo session id: the runtime resolves either.
 */
export function useOpenSessionHere(): (threadOrSessionId: string) => void {
	const aui = useAui();
	const sdk = useSdk("kilo-ui");
	return useCallback(
		(threadOrSessionId: string) => {
			// The Kilo server cannot clear an archive timestamp, so never unarchive.
			void aui.threads.switchToThread(threadOrSessionId, { unarchive: false });
			navigateToChat(sdk);
		},
		[aui, sdk],
	);
}

/**
 * Opens a card's chat. A popped-out board has no chat page of its own, so it
 * asks the main window to open the chat (by Kilo session id: thread ids are
 * local to each window's runtime) and brings that window forward.
 */
export function useOpenWorkspaceBoardSession(): (session: BoardSession) => void {
	const sdk = useSdk("kilo-ui");
	const openHere = useOpenSessionHere();
	const isDetached = useWorkspaceBoard()?.window.isDetached ?? false;
	return useCallback(
		(session: BoardSession) => {
			if (!isDetached) {
				openHere(session.threadId);
				return;
			}
			sdk.events.emit(WORKSPACE_BOARD_OPEN_SESSION_EVENT, {
				kiloSessionId: session.kiloSessionId,
			});
			void sdk.shell.focusMainWindow();
		},
		[isDetached, openHere, sdk],
	);
}
