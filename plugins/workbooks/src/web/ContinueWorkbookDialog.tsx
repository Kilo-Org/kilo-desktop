import { useState } from "react";

import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import type { TemplateSummary, Workbook } from "../contracts";
import { templateIcon } from "./template-icons";

/**
 * Starts a session on an existing workbook: a searchable list of the
 * workspace's workbooks, built like the workspace and model pickers (search,
 * one row per workbook, its template and date on the right). Choosing one
 * starts the session; the new chat starts from the workbook's Brief and guide.
 */
export function ContinueWorkbookDialog({
	workbooks,
	templates,
	busy,
	error,
	onStart,
	onClose,
}: {
	readonly workbooks: readonly Workbook[];
	readonly templates: readonly TemplateSummary[];
	readonly busy: boolean;
	readonly error: string | null;
	readonly onStart: (workbook: Workbook) => void;
	readonly onClose: () => void;
}) {
	const [startingId, setStartingId] = useState<string | null>(null);
	const close = (open: boolean) => {
		if (!open && !busy) onClose();
	};

	return (
		<CommandDialog
			open
			onOpenChange={close}
			title="Existing workbook"
			description="Choose a workbook in this workspace to start a session on"
			className="sm:max-w-lg"
		>
			<Command data-qa-id="workbooks-continue-dialog">
				<CommandInput placeholder="Search workbooks" disabled={busy} />
				<CommandList className="scroll-fade" data-qa-id="workbooks-list">
					<CommandEmpty>No workbooks found.</CommandEmpty>
					<CommandGroup>
						{workbooks.map((workbook) => {
							const template = templates.find((candidate) => candidate.id === workbook.templateId);
							const Icon = templateIcon(template?.icon);
							const starting = busy && startingId === workbook.id;
							return (
								<CommandItem
									key={workbook.id}
									value={workbook.id}
									keywords={[workbook.name, template?.name ?? workbook.templateId]}
									disabled={busy}
									data-qa-id={`workbooks-continue-${workbook.id}`}
									onSelect={() => {
										setStartingId(workbook.id);
										onStart(workbook);
									}}
								>
									{starting ? (
										<Spinner aria-hidden />
									) : (
										<Icon aria-hidden className="text-muted-foreground" />
									)}
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
				{error ? (
					<FieldError className="border-t px-3 py-2" data-qa-id="workbooks-start-error">
						{error}
					</FieldError>
				) : null}
			</Command>
		</CommandDialog>
	);
}
