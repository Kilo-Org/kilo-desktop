import { useAui, useAuiState } from "@assistant-ui/react";
import { useCallback, useMemo } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { navigateToChat } from "../chat-navigation.js";
import { useSessionActivity } from "../session-activity/SessionActivityProvider.js";
import { withDescendantPrompts } from "../session-activity/session-activity-logic.js";
import { buildBoardSessions, type BoardSession } from "./workspace-board-sessions.js";

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

export function useOpenWorkspaceBoardSession(): (session: BoardSession) => void {
	const aui = useAui();
	const sdk = useSdk("kilo-ui");
	return useCallback(
		(session: BoardSession) => {
			// The Kilo server cannot clear an archive timestamp, so never unarchive.
			void aui.threads.switchToThread(session.threadId, { unarchive: false });
			navigateToChat(sdk);
		},
		[aui, sdk],
	);
}
