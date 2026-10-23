import { useAuiState } from "@assistant-ui/react";

import { sessionIdOfThread, type SessionId } from "./session-identity.js";
import { useSessions } from "./SessionsProvider.js";

/**
 * The work session shown by the thread-list item in scope (inside a thread:
 * the open session). Undefined while no session is known to own its chat.
 */
export function useThreadSessionId(): SessionId | undefined {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const localThreadId = useAuiState((state) => state.threadListItem.id);
	return useSessions((state) =>
		sessionIdOfThread({ remoteId, localThreadId }, state.sessionIdByChat),
	);
}
