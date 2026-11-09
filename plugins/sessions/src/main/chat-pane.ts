import type { Pane, WorkSession, WorkSessionPanes } from "../contracts";

/**
 * kilo.chat's agent pane kind. Its contracts import these, so kilo.sessions
 * names the key itself rather than importing it.
 */
export const CHAT_PANE_KIND = "kilo.chat/agent";

/** A session's agent pane; without a chat in its metadata it shows the session's first chat. */
export function chatPane(session: Pick<WorkSession, "id" | "title">): Pane {
	return {
		id: `agent:${session.id}`,
		kind: CHAT_PANE_KIND,
		title: session.title,
		metadata: {},
		ordinal: 1,
	};
}

/**
 * Gives each session that holds chats but has no panes recorded its agent
 * pane; returns `bySession` itself when none needs one. A session whose
 * panes were all closed keeps its empty record, so it stays empty.
 */
export function withChatPanes(
	bySession: Readonly<Record<string, WorkSessionPanes>>,
	sessions: readonly WorkSession[],
): Readonly<Record<string, WorkSessionPanes>> {
	const missing = sessions.filter(
		(session) => session.chatIds.length > 0 && !bySession[session.id],
	);
	if (missing.length === 0) return bySession;
	const next = { ...bySession };
	for (const session of missing) {
		const pane = chatPane(session);
		next[session.id] = { panes: [pane], activePaneId: pane.id, layout: null, arrangement: "tiles" };
	}
	return next;
}
