import { useExtensions, useKernel } from "@kilo-desktop/kernel/web";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";

import {
	CLOSE_ALL_PANES_COMMAND,
	CLOSE_OTHER_PANES_COMMAND,
	CLOSE_PANE_COMMAND,
	CLOSE_PANES_TO_THE_RIGHT_COMMAND,
	COPY_PANE_PATH_COMMAND,
	COPY_PANE_RELATIVE_PATH_COMMAND,
	MOVE_PANE_DOWN_COMMAND,
	MOVE_PANE_LEFT_COMMAND,
	MOVE_PANE_RIGHT_COMMAND,
	MOVE_PANE_TO_NEW_WINDOW_COMMAND,
	MOVE_PANE_UP_COMMAND,
	PaneKind,
} from "../../contracts";
import type { PaneTabMenuTarget } from "../canvas/PaneTabStrip";
import { implementationOf } from "../shared/pane-kinds";
import { paneFilePath } from "../shared/pane-path";
import { useWorkSessionPanes } from "./use-work-session-panes";

const MOVES: readonly {
	readonly id: string;
	readonly label: string;
	readonly command: string;
}[] = [
	{ id: "up", label: "Move up", command: MOVE_PANE_UP_COMMAND },
	{ id: "down", label: "Move down", command: MOVE_PANE_DOWN_COMMAND },
	{ id: "left", label: "Move left", command: MOVE_PANE_LEFT_COMMAND },
	{ id: "right", label: "Move right", command: MOVE_PANE_RIGHT_COMMAND },
];

/**
 * A pane tab's right-click menu, mounted while it is open. Each item runs a
 * tab command for the tab; an item is disabled only when that is cheap to
 * tell, otherwise a command with nothing to do does nothing. The copy-path
 * group shows only for a tab that shows a file.
 */
export function PaneTabMenuItems({
	workSessionId,
	tab,
	canPopOut,
}: {
	readonly workSessionId: string;
	readonly tab: PaneTabMenuTarget;
	/** Panes can open in windows of their own (the desktop app). */
	readonly canPopOut: boolean;
}) {
	const kernel = useKernel();
	const paneId = tab.pane.id;
	const pane = useWorkSessionPanes(workSessionId).panes.find((entry) => entry.id === paneId);
	const kind = useExtensions(PaneKind).find((entry) => entry.key === pane?.kind);
	const hasPath = pane !== undefined && paneFilePath(pane, implementationOf(kind)) !== undefined;
	const run = (command: string) =>
		void kernel.commands.execute(command, { paneId }).catch(() => undefined);
	const lastInGroup = tab.index === tab.groupTabs.length - 1;

	return (
		<>
			<DropdownMenuGroup>
				<DropdownMenuItem data-qa-id="pane-tab-menu-close" onClick={() => run(CLOSE_PANE_COMMAND)}>
					Close
				</DropdownMenuItem>
				<DropdownMenuItem
					data-qa-id="pane-tab-menu-close-others"
					disabled={tab.groupTabs.length < 2}
					onClick={() => run(CLOSE_OTHER_PANES_COMMAND)}
				>
					Close others
				</DropdownMenuItem>
				<DropdownMenuItem
					data-qa-id="pane-tab-menu-close-right"
					disabled={lastInGroup}
					onClick={() => run(CLOSE_PANES_TO_THE_RIGHT_COMMAND)}
				>
					Close to the right
				</DropdownMenuItem>
				<DropdownMenuItem
					data-qa-id="pane-tab-menu-close-all"
					onClick={() => run(CLOSE_ALL_PANES_COMMAND)}
				>
					Close all
				</DropdownMenuItem>
			</DropdownMenuGroup>
			{hasPath ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							data-qa-id="pane-tab-menu-copy-path"
							onClick={() => run(COPY_PANE_PATH_COMMAND)}
						>
							Copy path
						</DropdownMenuItem>
						<DropdownMenuItem
							data-qa-id="pane-tab-menu-copy-relative-path"
							onClick={() => run(COPY_PANE_RELATIVE_PATH_COMMAND)}
						>
							Copy relative path
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</>
			) : null}
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger data-qa-id="pane-tab-menu-move">Move</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuGroup>
							{MOVES.map(({ id, label, command }) => (
								<DropdownMenuItem
									key={id}
									data-qa-id={`pane-tab-menu-move-${id}`}
									onClick={() => run(command)}
								>
									{label}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				{canPopOut ? (
					<DropdownMenuItem
						data-qa-id="pane-tab-menu-move-new-window"
						onClick={() => run(MOVE_PANE_TO_NEW_WINDOW_COMMAND)}
					>
						Move into new window
					</DropdownMenuItem>
				) : null}
			</DropdownMenuGroup>
		</>
	);
}
