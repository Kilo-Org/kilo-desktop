import { BrushCleaningIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { BOARD_MAX_COLUMNS } from "../contracts";
import { addColumnForNaming, requestClear } from "./board-actions";
import { cardCountOf } from "./board-columns";
import { useBoardState } from "./board-store";

/**
 * The board's header actions, beside its title in the main window's header
 * or its own window's. Adding a column lives here so it is reachable without
 * scrolling the board.
 */
export function BoardHeaderActions() {
	const board = useBoardState();
	const full = board.columns.length >= BOARD_MAX_COLUMNS;
	const empty = cardCountOf(board) === 0;
	return (
		<>
			<HeaderIconButton
				label="Add column"
				qaId="workspace-board-add-column"
				disabledReason={full ? `A board can have at most ${BOARD_MAX_COLUMNS} columns` : undefined}
				onClick={addColumnForNaming}
			>
				<PlusIcon className="size-3.5" aria-hidden />
			</HeaderIconButton>
			<HeaderIconButton
				label="Clear board"
				qaId="workspace-board-clear"
				disabledReason={empty ? "The board is already empty" : undefined}
				onClick={requestClear}
			>
				<BrushCleaningIcon className="size-3.5" aria-hidden />
			</HeaderIconButton>
		</>
	);
}

/** Disabled with a reason: the tooltip shows it and the button describes itself with it. */
function HeaderIconButton({
	label,
	qaId,
	disabledReason,
	onClick,
	children,
}: {
	readonly label: string;
	readonly qaId: string;
	readonly disabledReason?: string | undefined;
	readonly onClick: () => void;
	readonly children: ReactNode;
}) {
	const buttonProps = {
		type: "button",
		variant: "ghost",
		size: "icon-sm",
		"aria-label": label,
		"aria-description": disabledReason,
		"data-qa-id": qaId,
		disabled: disabledReason !== undefined,
		onClick,
	} as const;
	return (
		<Tooltip>
			{disabledReason ? (
				// A wrapper keeps the tooltip working while the button is disabled.
				<TooltipTrigger render={<span className="inline-flex" />}>
					<Button {...buttonProps}>{children}</Button>
				</TooltipTrigger>
			) : (
				<TooltipTrigger render={<Button {...buttonProps} />}>{children}</TooltipTrigger>
			)}
			<TooltipContent side="bottom">{disabledReason ?? label}</TooltipContent>
		</Tooltip>
	);
}
