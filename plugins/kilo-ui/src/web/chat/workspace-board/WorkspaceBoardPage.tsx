import { ExternalLinkIcon, Minimize2Icon, SquareKanbanIcon } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { useWorkspacesFeature } from "../../workspaces/WorkspacesFeatureContext.js";
import { ChatLocationBreadcrumb } from "../ChatSessionBreadcrumb.js";
import { DetachedWindowLayout } from "../DetachedWindowLayout.js";
import { resolveWorkspaceFocus } from "../session-list/session-list-view.js";
import { useSessionListView } from "../session-list/use-session-list-view.js";
import { resolveBoardColumns } from "./workspace-board-sessions.js";
import { WORKSPACE_BOARD_TITLE } from "./workspace-board-constants.js";
import { useWorkspaceBoard, type WorkspaceBoardContextValue } from "./WorkspaceBoardProvider.js";
import { WorkspaceBoardHeaderActions } from "./WorkspaceBoardHeaderActions.js";
import { WorkspaceBoardView } from "./WorkspaceBoardView.js";
import { workspaceBoardCardActions } from "./WorkspaceBoardCardActions.js";
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
	if (board.window.isDetached) return <DetachedWorkspaceBoard board={board} />;
	if (board.window.isPoppedOut) return <PoppedOutWorkspaceBoard board={board} />;
	return <WorkspaceBoardContent board={board} />;
}

/**
 * The board in its own window, naming the workspace the sidebar focuses
 * because that sidebar is now in another window.
 */
function DetachedWorkspaceBoard({ board }: { board: WorkspaceBoardContextValue }) {
	const { view } = useSessionListView();
	const { workspaces } = useWorkspacesFeature();
	const focus = resolveWorkspaceFocus(view.focus, workspaces);
	const workspace = focus ? workspaces.find((candidate) => candidate.id === focus) : undefined;
	return (
		<DetachedWindowLayout
			title={
				<ChatLocationBreadcrumb
					{...(workspace ? { locationLabel: workspace.name } : {})}
					{...(workspace?.color ? { locationColor: workspace.color } : {})}
					title={WORKSPACE_BOARD_TITLE}
					qaId="workspace-board-window-title"
				/>
			}
			actions={<WorkspaceBoardHeaderActions />}
			headerQaId="workspace-board-window-header"
		>
			<WorkspaceBoardContent board={board} />
		</DetachedWindowLayout>
	);
}

/** Matches a popped-out chat pane's placeholder. */
function PoppedOutWorkspaceBoard({ board }: { board: WorkspaceBoardContextValue }) {
	return (
		<Empty data-qa-id="workspace-board-popped-out" className="h-full">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SquareKanbanIcon aria-hidden />
				</EmptyMedia>
				<EmptyTitle>{WORKSPACE_BOARD_TITLE}</EmptyTitle>
				<EmptyDescription>The board is open in a separate window.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row flex-wrap justify-center">
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-qa-id="workspace-board-popped-out-focus"
					onClick={board.window.focus}
				>
					<ExternalLinkIcon />
					Bring to front
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-qa-id="workspace-board-popped-out-dock"
					onClick={board.window.dock}
				>
					<Minimize2Icon />
					Dock
				</Button>
			</EmptyContent>
		</Empty>
	);
}

/**
 * Filtered by the sidebar's workspace focus rather than a filter of its own:
 * the sidebar stays beside the board, and the board is a second view of the
 * same chats.
 */
function WorkspaceBoardContent({ board }: { board: WorkspaceBoardContextValue }) {
	const sessions = useWorkspaceBoardSessions();
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
			columnToName={board.columnNaming.columnToName}
			onColumnNamingStarted={board.columnNaming.onNamingStarted}
			onRenameColumn={board.renameColumn}
			onMoveColumn={board.moveColumn}
			onDeleteColumn={board.deleteColumn}
		/>
	);
}
