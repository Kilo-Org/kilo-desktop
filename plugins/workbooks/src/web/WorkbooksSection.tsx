import { ChevronDownIcon, NotebookTabsIcon, PlusIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import type { NewWorkSessionSectionProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@kilo-desktop/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { pickerMenuWidth } from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	SessionWorkbooks,
	WorkbookTemplates,
	Workbooks,
	workbooksIn,
	type TemplateSummary,
	type Workbook,
} from "../contracts";
import { NewWorkbookDialog } from "./NewWorkbookDialog";
import { startFromWorkbook, startNewWorkbook, type StartDeps } from "./start";
import { templateIcon } from "./template-icons";

const selectWorkbooks = (state: { workbooks: Workbook[] }) => state.workbooks;
const selectTemplates = (state: { templates: TemplateSummary[] }) => state.templates;

/** No row highlighted when the picker opens, as the workspace picker does. */
const NO_SELECTION = "__no-workbook-selection__";
const NEW_WORKBOOK = "new-workbook";

// Rows carry the workbook's name and template as keywords, so search never matches the id.
function filterByKeywords(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

/**
 * Workbooks on the New Session page (`kilo.work-sessions/new-work-session-section`):
 * one "Workbook" tile, in the style of the page's tool tiles, that opens a
 * searchable picker built to the dropdown standard (as the workspace picker):
 * the workspace's workbooks, then "New workbook" pinned under the list, which
 * opens the New workbook wizard. Picking a workbook starts the session where
 * the page says (workspace, isolation), its composer holding the kick-off,
 * unsent; a failure is a toast, since the picker has closed.
 */
export function WorkbooksSection({ workspaceId, disabled, start }: NewWorkSessionSectionProps) {
	const deps: StartDeps = {
		workbooks: useDomainObject(Workbooks),
		sessions: useDomainObject(SessionWorkbooks),
		composer: useDomainObject(Composer),
		start,
	};
	const workbooks = workbooksIn(
		useDomainObjectState(Workbooks, selectWorkbooks) ?? [],
		workspaceId,
	);
	const templates = useDomainObjectState(WorkbookTemplates, selectTemplates) ?? [];
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(NO_SELECTION);
	const [creating, setCreating] = useState(false);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const startExisting = async (workbook: Workbook) => {
		setOpen(false);
		setRunning(true);
		try {
			await startFromWorkbook(deps, { workbookId: workbook.id });
		} catch (failure) {
			toast.error(`Couldn't start a session on "${workbook.name}"`, {
				description: failure instanceof Error ? failure.message : String(failure),
			});
		} finally {
			setRunning(false);
		}
	};

	const create = async (templateId: string, name: string, values: Record<string, string>) => {
		if (workspaceId === null) return;
		setRunning(true);
		setError(null);
		try {
			await startNewWorkbook(deps, { workspaceId, templateId, name, values });
			setCreating(false);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setRunning(false);
		}
	};

	const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
		}
	};

	if (workspaceId === null) return null;
	return (
		<div
			data-qa-id="workbooks-section"
			className="grid w-full grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2"
		>
			<Popover
				open={open}
				onOpenChange={(next) => {
					if (next) setCommandValue(NO_SELECTION);
					setOpen(next);
				}}
			>
				<PopoverTrigger
					render={
						<button
							type="button"
							disabled={disabled || running}
							title="Start a session from a workbook: one in this workspace, or a new one."
							data-qa-id="workbooks-picker-trigger"
							onKeyDown={onTriggerKeyDown}
							className="bg-muted/60 hover:bg-muted focus-visible:ring-ring/50 disabled:hover:bg-muted/60 aria-expanded:bg-muted flex h-11 min-w-0 items-center gap-1.5 rounded-[10px] ps-3 pe-2 text-start text-[13px] transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
						/>
					}
				>
					{running ? (
						<Spinner aria-hidden className="size-3.5 shrink-0" />
					) : (
						<NotebookTabsIcon className="size-3.5 shrink-0" />
					)}
					<span className="whitespace-nowrap">Workbook</span>
					<ChevronDownIcon className="text-muted-foreground ms-auto size-3.5 shrink-0" />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					side="bottom"
					collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
					className={cn(pickerMenuWidth, "gap-0 p-0")}
					data-qa-id="workbooks-picker"
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false);
					}}
				>
					<Command
						label="Search workbooks"
						value={commandValue}
						onValueChange={setCommandValue}
						filter={filterByKeywords}
					>
						<CommandInput placeholder="Search workbooks" />
						<CommandList className="scroll-fade">
							<CommandEmpty>
								{workbooks.length === 0
									? "No workbooks in this workspace yet."
									: "No workbooks found."}
							</CommandEmpty>
							<CommandGroup>
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
											onSelect={() => void startExisting(workbook)}
										>
											<Icon className="text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate">{workbook.name}</span>
											<span className="text-muted-foreground shrink-0 text-xs">
												{template?.name ?? workbook.templateId}
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
						{/* Outside the list, so it must opt out of cmdk hiding it while filtering. */}
						<CommandSeparator alwaysRender />
						<CommandGroup forceMount>
							<CommandItem
								value={NEW_WORKBOOK}
								disabled={templates.length === 0}
								data-qa-id="workbooks-new"
								onSelect={() => {
									setOpen(false);
									setError(null);
									setCreating(true);
								}}
							>
								<PlusIcon />
								New workbook
							</CommandItem>
						</CommandGroup>
					</Command>
				</PopoverContent>
			</Popover>
			{creating ? (
				<NewWorkbookDialog
					templates={templates}
					busy={running}
					error={error}
					onClose={() => setCreating(false)}
					onCreate={(templateId, name, values) => void create(templateId, name, values)}
				/>
			) : null}
		</div>
	);
}
