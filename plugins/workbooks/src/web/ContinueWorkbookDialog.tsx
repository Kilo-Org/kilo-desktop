import { NotebookTabsIcon } from "lucide-react";
import { useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { FieldError } from "@kilo-desktop/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";

import type { Workbook, Workbooks } from "../contracts";
import { ResumeWorkbook, type ResumeChoice } from "./ResumeWorkbook";

/**
 * Continues a workbook in the workspace: pick one, see where it's at (the
 * resume view), then start a session on a suggested next step or on the
 * workbook as a whole.
 */
export function ContinueWorkbookDialog({
	workbooks,
	handle,
	busy,
	error,
	onStart,
	onClose,
}: {
	readonly workbooks: readonly Workbook[];
	readonly handle: DomainObjectHandle<typeof Workbooks> | null;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onStart: (workbook: Workbook, choice: ResumeChoice) => void;
	readonly onClose: () => void;
}) {
	const [picked, setPicked] = useState<Workbook | null>(
		workbooks.length === 1 ? workbooks[0]! : null,
	);
	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent data-qa-id="workbooks-continue-dialog" className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Continue a workbook</DialogTitle>
					<DialogDescription>
						Pick up where the last session left off. The new chat starts from the workbook's Brief
						and guide.
					</DialogDescription>
				</DialogHeader>
				{picked ? (
					<ResumeWorkbook
						workbook={picked}
						workbooks={handle}
						busy={busy}
						{...(workbooks.length > 1 ? { onBack: () => setPicked(null) } : {})}
						onStart={(choice) => onStart(picked, choice)}
					/>
				) : (
					<ItemGroup className="gap-2" data-qa-id="workbooks-list">
						{workbooks.map((workbook) => (
							<Item key={workbook.id} variant="outline" size="sm">
								<ItemMedia variant="icon">
									<NotebookTabsIcon />
								</ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle className="truncate">{workbook.name}</ItemTitle>
									<ItemDescription>
										Started {new Date(workbook.createdAt).toLocaleDateString()}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<Button
										type="button"
										size="sm"
										variant="outline"
										data-qa-id={`workbooks-continue-${workbook.id}`}
										onClick={() => setPicked(workbook)}
									>
										Open
									</Button>
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				)}
				{error ? <FieldError data-qa-id="workbooks-start-error">{error}</FieldError> : null}
			</DialogContent>
		</Dialog>
	);
}
