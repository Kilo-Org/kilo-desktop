import { useAui, useAuiState } from "@assistant-ui/react";
import { useCallback, useMemo } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { navigateToChat } from "../chat-navigation.js";
import { useSessionActivity } from "../session-activity/SessionActivityProvider.js";
import { withDescendantPrompts } from "../session-activity/session-activity-logic.js";
import { buildBoardSessions, type BoardSession } from "./workspace-board-sessions.js";
import { WORKSPACE_BOARD_OPEN_SESSION_EVENT } from "./workspace-board-window.js";
import { useWorkspaceBoard } from "./WorkspaceBoardProvider.js";

/** Loaded chats with their live activity, keyed by Kilo session id. */
export function useWorkspaceBoardSessions(): ReadonlyMap<string, BoardSession> {
	const threadItems = useAuiState((s) => s.threads.threadItems);
	const activityBySessionId = useSessionActivity((s) => withDescendantPrompts(s.sessions));
	const lastVisitedAtBySessionId = useSessionActivity((s) => s.lastVisitedAtBySessionId);
	return useMemo(
		() => buildBoardSessions({ threadItems, activityBySessionId, lastVisitedAtBySessionId }),
		[activityBySessionId, lastVisitedAtBySessionId, threadItems],
	);
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
 * asks the main window to open the chat (by session id: thread ids are local
 * to each window's runtime) and brings that window forward.
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
			sdk.events.emit(WORKSPACE_BOARD_OPEN_SESSION_EVENT, { sessionId: session.sessionId });
			void sdk.shell.focusMainWindow();
		},
		[isDetached, openHere, sdk],
	);
}
