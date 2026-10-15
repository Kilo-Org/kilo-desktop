import { SquareKanbanIcon } from "lucide-react";
import { useMemo } from "react";

import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { useWorkspacesFeature } from "../../workspaces/WorkspacesFeatureContext.js";
import { resolveWorkspaceFocus } from "../session-list/session-list-view.js";
import { useSessionListView } from "../session-list/use-session-list-view.js";
import { resolveBoardColumns } from "./workspace-board-sessions.js";
import { useWorkspaceBoard, type WorkspaceBoardContextValue } from "./WorkspaceBoardProvider.js";
import { WorkspaceBoardView } from "./WorkspaceBoardView.js";
import { workspaceBoardCardActions } from "./WorkspaceBoardCardActions.js";
import { useAddColumnForNaming } from "./use-add-column-for-naming.js";
import {
	useWorkspaceBoardSessions,
	useOpenWorkspaceBoardSession,
} from "./use-workspace-board-sessions.js";

export function WorkspaceBoardPage() {
	const board = useWorkspaceBoard();
	if (!board) {
		return (
			<Empty data-qa-id="workspace-board-unavailable" className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SquareKanbanIcon aria-hidden />
					</EmptyMedia>
					<EmptyTitle>Workspace Board unavailable</EmptyTitle>
					<EmptyDescription>This feature is not enabled for your account.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return <WorkspaceBoardContent board={board} />;
}

/**
 * Filtered by the sidebar's workspace focus rather than a filter of its own:
 * the sidebar stays beside the board, and the board is a second view of the
 * same chats.
 */
function WorkspaceBoardContent({ board }: { board: WorkspaceBoardContextValue }) {
	const sessions = useWorkspaceBoardSessions();
	const naming = useAddColumnForNaming(board);
	const openSession = useOpenWorkspaceBoardSession();
	const { view } = useSessionListView();
	const { workspaces } = useWorkspacesFeature();
	const focus = resolveWorkspaceFocus(view.focus, workspaces);
	const columns = useMemo(
		() => resolveBoardColumns(board.board, sessions, focus),
		[board.board, focus, sessions],
	);

	return (
		<WorkspaceBoardView
			columns={columns}
			workspaces={workspaces}
			onDragStart={board.startDrag}
			onOpen={openSession}
			cardActions={workspaceBoardCardActions}
			onAddColumn={naming.onAddColumn}
			columnToName={naming.columnToName}
			onColumnNamingStarted={naming.onColumnNamingStarted}
			onRenameColumn={board.renameColumn}
			onMoveColumn={board.moveColumn}
			onDeleteColumn={board.deleteColumn}
		/>
	);
}
