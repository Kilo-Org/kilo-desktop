import { ThreadListItemByIndexProvider, useAuiState } from "@assistant-ui/react";
import type { FC, ReactNode } from "react";

import {
	SessionItemRename,
	SessionRowMenu,
	SessionRowWorktreeDialog,
	useSessionRowActions,
} from "../components/assistant-ui/session-row-actions.js";
import { sessionRowCapabilities } from "../session-activity/session-activity-logic.js";
import { useSessionListPins } from "../session-list/use-session-list-view.js";
import { useSessionRowBoard } from "./use-session-row-board.js";
import type { WorkspaceBoardCardActions } from "./WorkspaceBoardCard.js";
import type { BoardSession } from "./workspace-board-sessions.js";

/**
 * The sidebar's chat actions act on assistant-ui's thread-list-item scope. A card
 * gets the same scope by its chat's position in the (archived) thread list, so it
 * shares the sidebar's menu, rename and worktree-aware delete as they are.
 */
const ThreadScope: FC<{ threadId: string; children: ReactNode }> = ({ threadId, children }) => {
	const index = useAuiState((s) => s.threads.threadIds.indexOf(threadId));
	const archivedIndex = useAuiState((s) => s.threads.archivedThreadIds.indexOf(threadId));
	if (index < 0 && archivedIndex < 0) return null;
	return (
		<ThreadListItemByIndexProvider index={index >= 0 ? index : archivedIndex} archived={index < 0}>
			{children}
		</ThreadListItemByIndexProvider>
	);
};

const CardMenu: WorkspaceBoardCardActions["Menu"] = ({ session, triggerRef, onRename }) => {
	const itemStatus = useAuiState((s) => s.threadListItem.status);
	const { canArchive, canPin } = sessionRowCapabilities(
		itemStatus === "archived",
		session.rowState,
	);
	const pins = useSessionListPins();
	const board = useSessionRowBoard(session.sessionId, session.title);
	const { archive, deleteThread, worktreeDialog } = useSessionRowActions({
		remoteId: session.sessionId,
		activity: session.activity,
		onDeleted: board?.remove,
	});
	return (
		<>
			<SessionRowMenu
				canArchive={canArchive}
				canPin={canPin}
				pinned={pins.ids.includes(session.sessionId)}
				onPin={() => pins.toggle(session.sessionId)}
				onRename={onRename}
				onArchive={archive}
				onDelete={deleteThread}
				board={board}
				triggerRef={triggerRef}
				label={`Chat actions for ${session.title}`}
				showPinShortcut={false}
				side="bottom"
			/>
			<SessionRowWorktreeDialog dialog={worktreeDialog} />
		</>
	);
};

function ScopedCardMenu(props: Parameters<WorkspaceBoardCardActions["Menu"]>[0]) {
	return (
		<ThreadScope threadId={props.session.threadId}>
			<CardMenu {...props} />
		</ThreadScope>
	);
}

function ScopedCardRename({
	session,
	onDone,
}: {
	session: BoardSession;
	onDone: (restoreFocus: boolean) => void;
}) {
	return (
		<ThreadScope threadId={session.threadId}>
			<SessionItemRename onDone={onDone} />
		</ThreadScope>
	);
}

export const workspaceBoardCardActions: WorkspaceBoardCardActions = {
	Menu: ScopedCardMenu,
	Rename: ScopedCardRename,
};
