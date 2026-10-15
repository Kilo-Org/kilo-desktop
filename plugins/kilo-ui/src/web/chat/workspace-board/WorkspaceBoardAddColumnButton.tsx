import { PlusIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { WORKSPACE_BOARD_MAX_COLUMNS } from "../../../contracts/workspace-board/schemas.js";

const fullReason = `A board can have at most ${WORKSPACE_BOARD_MAX_COLUMNS} columns`;

/** A dashed slot with the footprint of the next column's header, after the last column. */
export const WorkspaceBoardAddColumnButton: FC<{ disabled: boolean; onAdd: () => void }> = ({
	disabled,
	onAdd,
}) => {
	const button = (
		<Button
			type="button"
			variant="ghost"
			// The visible label names it; when disabled, the name also says why.
			aria-label={disabled ? `Add another column (${fullReason})` : undefined}
			data-qa-id="workspace-board-add-column"
			disabled={disabled}
			className="text-muted-foreground border-border h-10 w-72 justify-start rounded-xl border-dashed bg-clip-border px-3"
			onClick={onAdd}
		>
			<PlusIcon data-icon="inline-start" aria-hidden />
			Add another column
		</Button>
	);
	return (
		<Tooltip disabled={!disabled}>
			<TooltipTrigger
				render={
					// A wrapper keeps the tooltip working while the button is disabled.
					<span className="inline-flex shrink-0 self-start" />
				}
			>
				{button}
			</TooltipTrigger>
			<TooltipContent side="bottom">{fullReason}</TooltipContent>
		</Tooltip>
	);
};
