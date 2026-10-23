import {
	deletedColumnDestination,
	type WorkspaceBoardState,
} from "../../../contracts/workspace-board/board-model.js";
import {
	deriveSessionRowState,
	type SessionActivity,
	type SessionRowState,
} from "../activity/session-activity-logic.js";
import { matchesWorkspaceFocus } from "../list/session-list-view.js";
import { UNTITLED_SESSION_TITLE } from "../session-title.js";
import { sessionIdOfThread } from "../session-identity.js";

/** A work session as the board needs to render it, keyed by its session id. */
export type BoardSession = {
	sessionId: string;
	/** The session's chat; chat actions (rename, archive, delete) act on it. */
	kiloSessionId: string;
	/** assistant-ui's local thread id, used to switch to the chat. */
	threadId: string;
	title: string;
	archived: boolean;
	activity: SessionActivity | undefined;
	rowState: SessionRowState;
};

export type BoardColumnView = {
	id: string;
	label: string;
	cards: readonly BoardSession[];
	/** Every card in the column, including ones hidden by the filter or not loaded. */
	cardCount: number;
	/** Label of the column that receives this column's cards if it is deleted. */
	deleteDestination: string | null;
};

type ThreadItem = {
	id: string;
	remoteId: string | undefined;
	title?: string | undefined;
	status: string;
};

/** Only sessions whose chat the server has created can be placed: drafts are not on the board. */
export function buildBoardSessions(input: {
	threadItems: readonly ThreadItem[];
	/** Which work session owns each chat; chats no session owns get no card. */
	sessionIdByChat: Readonly<Record<string, string>>;
	activityBySessionId: Readonly<Record<string, SessionActivity>>;
	lastVisitedAtBySessionId: Readonly<Record<string, number>>;
}): ReadonlyMap<string, BoardSession> {
	const sessions = new Map<string, BoardSession>();
	for (const item of input.threadItems) {
		if (!item.remoteId) continue;
		const activity = input.activityBySessionId[item.remoteId];
		const sessionId = sessionIdOfThread(
			{ remoteId: item.remoteId, localThreadId: item.id },
			input.sessionIdByChat,
		);
		if (!sessionId) continue;
		sessions.set(sessionId, {
			sessionId,
			kiloSessionId: item.remoteId,
			threadId: item.id,
			title: item.title || UNTITLED_SESSION_TITLE,
			archived: item.status === "archived",
			activity,
			rowState: deriveSessionRowState(activity, input.lastVisitedAtBySessionId[item.remoteId]),
		});
	}
	return sessions;
}

/**
 * Cards whose chat is not loaded stay on the persisted board but are not shown:
 * the session list is paginated, so a missing chat may simply not be loaded yet.
 */
export function resolveBoardColumns(
	board: WorkspaceBoardState,
	sessions: ReadonlyMap<string, BoardSession>,
	workspaceFocus: string | null,
): BoardColumnView[] {
	return board.columns.map((column) => ({
		id: column.id,
		label: column.label,
		cardCount: column.sessionIds.length,
		deleteDestination: deletedColumnDestination(board, column.id)?.label ?? null,
		cards: column.sessionIds.flatMap((sessionId) => {
			const session = sessions.get(sessionId);
			if (!session) return [];
			if (!matchesWorkspaceFocus(session.activity?.workspaceId, workspaceFocus)) return [];
			return [session];
		}),
	}));
}

export type BoardCardStatus = Exclude<SessionRowState, null> | "archived" | "idle";

/**
 * Every card shows one status. Live states that need attention or show work in
 * progress outrank being archived; archived outranks an unread result.
 */
export function boardCardStatus(
	session: Pick<BoardSession, "archived" | "rowState">,
): BoardCardStatus {
	const { rowState } = session;
	if (rowState === "approval" || rowState === "input" || rowState === "working") return rowState;
	if (session.archived) return "archived";
	return rowState ?? "idle";
}
