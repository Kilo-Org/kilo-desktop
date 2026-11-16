import { NotebookTabsIcon } from "lucide-react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { START_DIALOG } from "../contracts";

/** Opens "Start from a workbook" from the session list's header. */
export function WorkbooksButton() {
	const navigation = useDomainObject(Navigation);
	if (!navigation) return null;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Start from a workbook"
						data-qa-id="session-list-workbooks"
						className="text-muted-foreground shrink-0 rounded-md"
						onClick={() => void navigation.methods.openDialog({ dialog: START_DIALOG })}
					/>
				}
			>
				<NotebookTabsIcon />
			</TooltipTrigger>
			<TooltipContent side="bottom">Start from a workbook</TooltipContent>
		</Tooltip>
	);
}
