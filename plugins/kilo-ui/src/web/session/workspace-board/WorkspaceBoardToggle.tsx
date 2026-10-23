import { SquareKanbanIcon } from "lucide-react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { navigateToChat } from "../../chat/chat-navigation.js";
import { WORKSPACE_BOARD_ROUTE_PATH } from "./workspace-board-constants.js";
import { useWorkspaceBoard, type WorkspaceBoardContextValue } from "./WorkspaceBoardProvider.js";

/**
 * Toggles between the board and the chat from the sidebar's list header; pressed
 * while the board is open, in the selected-row colour. A ghost button like the
 * list-options button beside it, so the two share size and hover. While the
 * board is popped out it brings that window forward instead. Absent while the
 * board feature is off.
 */
export function WorkspaceBoardToggle() {
	const board = useWorkspaceBoard();
	const sdk = useSdk("kilo-ui");
	if (!board) return null;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Workspace Board"
						aria-pressed={board.window.isPoppedOut ? undefined : board.isOpen}
						data-qa-id="session-list-board"
						className="text-muted-foreground aria-pressed:bg-state-selected aria-pressed:text-sidebar-foreground aria-pressed:hover:bg-state-selected shrink-0 rounded-md"
						onClick={() => {
							if (board.window.isPoppedOut) board.window.focus();
							else if (board.isOpen) navigateToChat(sdk);
							else sdk.navigate(WORKSPACE_BOARD_ROUTE_PATH);
						}}
					/>
				}
			>
				<SquareKanbanIcon />
			</TooltipTrigger>
			<TooltipContent side="bottom">{toggleLabel(board)}</TooltipContent>
		</Tooltip>
	);
}

function toggleLabel(board: WorkspaceBoardContextValue): string {
	if (board.window.isPoppedOut) return "Bring Workspace Board to front";
	return board.isOpen ? "Hide Workspace Board" : "Show Workspace Board";
}
