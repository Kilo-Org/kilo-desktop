import { ThreadListItemByIndexProvider, useAuiState } from "@assistant-ui/react";
import { useMemo, type FC, type ReactNode } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import {
	SessionItemRename,
	SessionRenameInput,
	SessionRowMenu,
	SessionRowWorktreeDialog,
	useSessionRowActions,
	type SessionRowOperations,
} from "../components/assistant-ui/session-row-actions.js";
import { sessionRowCapabilities } from "../session-activity/session-activity-logic.js";
import { useSessionListPins } from "../session-list/use-session-list-view.js";
import { useSessionRowBoard } from "./use-session-row-board.js";
import { requestMainWindowChatAction, type ChatAction } from "./workspace-board-window.js";
import type { WorkspaceBoardCardActions } from "./WorkspaceBoardCard.js";
import type { BoardSession } from "./workspace-board-sessions.js";

type MenuProps = Parameters<WorkspaceBoardCardActions["Menu"]>[0];

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

const CardMenu: FC<MenuProps & { operations?: SessionRowOperations }> = ({
	session,
	triggerRef,
	onRename,
	operations,
}) => {
	const { canArchive, canPin } = sessionRowCapabilities(session.archived, session.rowState);
	const pins = useSessionListPins();
	const board = useSessionRowBoard(session.sessionId, session.title);
	const { archive, deleteThread, worktreeDialog } = useSessionRowActions({
		remoteId: session.sessionId,
		activity: session.activity,
		onDeleted: board?.remove,
		operations,
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
				label={`Session actions for ${session.title}`}
				side="bottom"
			/>
			<SessionRowWorktreeDialog dialog={worktreeDialog} />
		</>
	);
};

function ScopedCardMenu(props: MenuProps) {
	return (
		<ThreadScope threadId={props.session.threadId}>
			<CardMenu {...props} />
		</ThreadScope>
	);
}

type CardRenameProps = { session: BoardSession; onDone: (restoreFocus: boolean) => void };

function ScopedCardRename({ session, onDone }: CardRenameProps) {
	return (
		<ThreadScope threadId={session.threadId}>
			<SessionItemRename onDone={onDone} />
		</ThreadScope>
	);
}

/** The board in this window acts on chats through this window's thread list. */
export const workspaceBoardCardActions: WorkspaceBoardCardActions = {
	Menu: ScopedCardMenu,
	Rename: ScopedCardRename,
};

function useMainWindowChatOperations(sessionId: string) {
	const sdk = useSdk("kilo-ui");
	return useMemo(() => {
		const request = (action: ChatAction) => requestMainWindowChatAction(sdk.events, action);
		return {
			rename: async (title: string) => {
				await request({ action: "rename", sessionId, title });
			},
			archive: async () => {
				await request({ action: "archive", sessionId });
			},
			delete: async () => {
				await request({ action: "delete", sessionId });
			},
			checkOrphanedWorktree: async () => {
				const { orphanedWorktree } = await request({
					action: "check-orphaned-worktree",
					sessionId,
				});
				return orphanedWorktree === true;
			},
		};
	}, [sdk, sessionId]);
}

function MainWindowCardMenu(props: MenuProps) {
	const operations = useMainWindowChatOperations(props.session.sessionId);
	return <CardMenu {...props} operations={operations} />;
}

function MainWindowCardRename({ session, onDone }: CardRenameProps) {
	const { rename } = useMainWindowChatOperations(session.sessionId);
	return <SessionRenameInput title={session.title} onRename={rename} onDone={onDone} />;
}

/** The popped-out board acts on chats through the main window (see `workspace-board-window`). */
export const mainWindowCardActions: WorkspaceBoardCardActions = {
	Menu: MainWindowCardMenu,
	Rename: MainWindowCardRename,
};
