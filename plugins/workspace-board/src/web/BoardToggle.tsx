import { SquareKanbanIcon } from "lucide-react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Workbench, type WorkbenchState } from "@kilo-desktop/plugin-workbench/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { BOARD_TITLE, BOARD_VIEW } from "../contracts";
import { toggleBoard } from "./board-actions";

const selectShown = (state: WorkbenchState) => state.view === BOARD_VIEW;
const selectDetached = (state: WorkbenchState) => state.detachedViews.includes(BOARD_VIEW);

/**
 * Toggles between the board and the open session from the session list's
 * header (kilo.workbench/navigator-action); pressed while the board shows.
 * While the board is popped out it brings that window forward instead.
 */
export function BoardToggle() {
	const navigator = useDomain(Workbench);
	const shown = useDomainState(Workbench, selectShown) ?? false;
	const detached = useDomainState(Workbench, selectDetached) ?? false;
	if (!navigator) return null;
	const label = detached
		? `Bring ${BOARD_TITLE} to front`
		: shown
			? `Hide ${BOARD_TITLE}`
			: `Show ${BOARD_TITLE}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={BOARD_TITLE}
						aria-pressed={detached ? undefined : shown}
						data-qa-id="session-list-board"
						className="text-muted-foreground aria-pressed:bg-state-selected aria-pressed:text-sidebar-foreground aria-pressed:hover:bg-state-selected shrink-0 rounded-md"
						onClick={() => toggleBoard(navigator, "toggle")}
					/>
				}
			>
				<SquareKanbanIcon />
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}
