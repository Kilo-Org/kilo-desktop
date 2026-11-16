import { useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { FieldError } from "@kilo-desktop/ui/components/field";

import type { TemplateSummary, Workbook, Workbooks } from "../contracts";
import { ResumeWorkbook, type ResumeChoice } from "./ResumeWorkbook";
import { templateIcon } from "./template-icons";

/**
 * Starts a session on an existing workbook. First a searchable list of the
 * workspace's workbooks, built like the workspace and model pickers (a
 * command list: search, one row per workbook, its template and date on the
 * right); choosing one shows where it's at (the resume view), with Back to
 * the list.
 */
export function ContinueWorkbookDialog({
	workbooks,
	templates,
	handle,
	busy,
	error,
	onStart,
	onClose,
}: {
	readonly workbooks: readonly Workbook[];
	readonly templates: readonly TemplateSummary[];
	readonly handle: DomainObjectHandle<typeof Workbooks> | null;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onStart: (workbook: Workbook, choice: ResumeChoice) => void;
	readonly onClose: () => void;
}) {
	const [picked, setPicked] = useState<Workbook | null>(null);
	const close = (open: boolean) => {
		if (!open && !busy) onClose();
	};

	if (!picked) {
		return (
			<CommandDialog
				open
				onOpenChange={close}
				title="Existing workbook"
				description="Choose a workbook in this workspace to start a session on"
				className="sm:max-w-lg"
			>
				<Command data-qa-id="workbooks-continue-dialog">
					<CommandInput placeholder="Search workbooks" data-qa-id="workbooks-search" />
					<CommandList className="scroll-fade" data-qa-id="workbooks-list">
						<CommandEmpty>No workbooks found.</CommandEmpty>
						<CommandGroup heading="Workbooks in this workspace">
							{workbooks.map((workbook) => {
								const template = templates.find(
									(candidate) => candidate.id === workbook.templateId,
								);
								const Icon = templateIcon(template?.icon);
								return (
									<CommandItem
										key={workbook.id}
										value={workbook.id}
										keywords={[workbook.name, template?.name ?? workbook.templateId]}
										data-qa-id={`workbooks-continue-${workbook.id}`}
										onSelect={() => setPicked(workbook)}
									>
										<Icon aria-hidden className="text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate">{workbook.name}</span>
										<span className="text-muted-foreground shrink-0 text-xs">
											{template?.name ?? workbook.templateId} ·{" "}
											{new Date(workbook.createdAt).toLocaleDateString(undefined, {
												day: "numeric",
												month: "short",
											})}
										</span>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</CommandDialog>
		);
	}

	return (
		<Dialog open onOpenChange={close}>
			<DialogContent
				data-qa-id="workbooks-resume-dialog"
				className="max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg"
			>
				<DialogHeader>
					<DialogTitle>{picked.name}</DialogTitle>
					<DialogDescription>
						Start a session where this workbook left off. The new chat starts from its Brief and
						guide.
					</DialogDescription>
				</DialogHeader>
				<div className="scroll-fade-y -mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4">
					<ResumeWorkbook
						workbook={picked}
						workbooks={handle}
						busy={busy}
						onBack={() => setPicked(null)}
						onStart={(choice) => onStart(picked, choice)}
					/>
					{error ? <FieldError data-qa-id="workbooks-start-error">{error}</FieldError> : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
