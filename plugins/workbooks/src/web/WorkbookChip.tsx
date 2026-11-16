import { NotebookTabsIcon } from "lucide-react";

import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import type { WorkSessionActionProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { SessionWorkbooks, Workbooks, type Workbook } from "../contracts";

/**
 * The open work session's active workbook, as a small chip in its header;
 * clicking opens the workbook in the browser. Absent for sessions without one.
 */
export function WorkbookChip({ workSession }: WorkSessionActionProps) {
	const workbookId = useDomainObjectState(
		SessionWorkbooks,
		(state) => state.bySession[workSession.id],
	);
	const workbook = useDomainObjectState(Workbooks, (state) =>
		state.workbooks.find((candidate: Workbook) => candidate.id === workbookId),
	);
	const os = useDomainObject(KernelOs);
	if (!workbook) return null;
	const open =
		workbook.url && os ? () => void os.methods.openExternal({ url: workbook.url! }) : undefined;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="xs"
						data-qa-id="workbooks-chip"
						aria-label={`Workbook: ${workbook.name}`}
						className="text-muted-foreground max-w-48 gap-1"
						disabled={!open}
						onClick={open}
					/>
				}
			>
				<NotebookTabsIcon aria-hidden />
				<span className="truncate">{workbook.name}</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				Workbook: {workbook.name}
				{open ? " · open it" : ""}
			</TooltipContent>
		</Tooltip>
	);
}
