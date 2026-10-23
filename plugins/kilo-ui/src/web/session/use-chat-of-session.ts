import type { KiloSessionId, SessionId } from "./session-identity.js";
import { useSessions } from "./SessionsProvider.js";

/**
 * The Kilo session id of a session's chat, for a window that knows the session
 * but not its chat (a popped-out pane). Undefined until the sessions are
 * loaded, and for a session without a chat. Today a session has at most one.
 */
export function useChatOfSession(sessionId: SessionId | undefined): KiloSessionId | undefined {
	return useSessions((state) => (sessionId ? state.sessions[sessionId]?.chatIds[0] : undefined));
}
