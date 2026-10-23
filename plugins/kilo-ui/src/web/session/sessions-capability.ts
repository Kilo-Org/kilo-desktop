/**
 * Renderer capability (`sdk.plugins.get("kilo-ui").sessions`) that tells other
 * plugins which work session a chat belongs to. Agent tools receive the
 * calling chat's Kilo session id; the panes and workspace they act on belong
 * to that chat's session, so tools resolve it here before using
 * `chatRightPanel` or `chatSessionWorkspace`. A chat no session owns (a
 * subagent's, or one not loaded yet) has none, and tools must not guess one.
 */
import type { KiloSessionId, SessionId } from "./session-identity.js";
import type { SessionsStore } from "./sessions-store.js";

export type SessionsCapability = {
	sessionIdOfChat(kiloSessionId: KiloSessionId): SessionId | undefined;
};

export type SessionsCapabilities = {
	readonly sessions: SessionsCapability;
};

export function createSessionsCapability(
	store: Pick<SessionsStore, "getState">,
): SessionsCapability {
	return {
		sessionIdOfChat: (kiloSessionId) => store.getState().sessionIdByChat[kiloSessionId],
	};
}
