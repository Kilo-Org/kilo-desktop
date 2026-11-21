import { ArrowRightIcon, ChevronDownIcon, NotebookTabsIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

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
import { Button } from "@kilo-desktop/ui/components/button";
import { LocationCapsule, LocationField } from "@kilo-desktop/ui/components/location-capsule";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { pickerMenuWidth } from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	SessionWorkbooks,
	WorkbookTemplates,
	Workbooks,
	workbooksFor,
	type TemplateSummary,
	type Workbook,
} from "../contracts";
import { NewWorkbookDialog } from "./NewWorkbookDialog";
import { startFromWorkbook, type StartDeps } from "./start";
import { TemplateIcon } from "./template-icons";

const selectWorkbooks = (state: { workbooks: Workbook[] }) => state.workbooks;
const selectRefreshing = (state: { refreshing: boolean }) => state.refreshing;
const selectRefreshError = (state: { refreshError: string | null }) => state.refreshError;
const selectTemplates = (state: { templates: TemplateSummary[] }) => state.templates;

/** The template's name, or the workbook's own record of it when the template isn't on offer. */
function templateLabel(workbook: Workbook, template: TemplateSummary | undefined): string {
	return template?.name ?? workbook.templateName ?? workbook.templateId;
}

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
 * one row, in the style of the page's location capsule: "Workbook", a
 * searchable picker built to the dropdown standard (as the workspace picker:
 * every workbook, those used in the page's workspace first, then "New
 * workbook" pinned under the list, which opens the wizard) and "Start
 * session". Choosing never starts anything: picking a workbook, or creating
 * one in the wizard, selects it, and Start session (disabled until then)
 * starts the session where the page says (workspace, isolation), its composer
 * holding the kick-off, unsent. The list is the last one found in Pages,
 * refreshed when the section shows and each time the picker opens. A failure
 * is a toast.
 */
export function WorkbooksSection({ workspaceId, disabled, start }: NewWorkSessionSectionProps) {
	const deps: StartDeps = {
		workbooks: useDomainObject(Workbooks),
		sessions: useDomainObject(SessionWorkbooks),
		composer: useDomainObject(Composer),
		start,
	};
	const all = useDomainObjectState(Workbooks, selectWorkbooks) ?? [];
	const refreshing = useDomainObjectState(Workbooks, selectRefreshing) ?? false;
	const refreshError = useDomainObjectState(Workbooks, selectRefreshError) ?? null;
	const { here, elsewhere } = workbooksFor(all, workspaceId);
	const workbooksHandle = deps.workbooks;
	const refresh = () => void workbooksHandle?.methods.refresh(undefined);
	useEffect(() => {
		void workbooksHandle?.methods.refresh(undefined);
	}, [workbooksHandle]);
	const templates = useDomainObjectState(WorkbookTemplates, selectTemplates) ?? [];
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(NO_SELECTION);
	const [creating, setCreating] = useState(false);
	const [running, setRunning] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// A workbook made in the wizard starts with its first move, not where it left off.
	const [createdId, setCreatedId] = useState<string | null>(null);
	// A forgotten workbook is no selection.
	const selected = all.find((workbook) => workbook.id === selectedId) ?? null;
	const [error, setError] = useState<string | null>(null);

	const startExisting = async (workbook: Workbook) => {
		setRunning(true);
		try {
			await startFromWorkbook(deps, {
				workbookId: workbook.id,
				...(workbook.id === createdId ? { fresh: true } : {}),
			});
		} catch (failure) {
			toast.error(`Couldn't start a session on "${workbook.name}"`, {
				description: failure instanceof Error ? failure.message : String(failure),
			});
		}
		setRunning(false);
	};

	const select = (workbook: Workbook) => {
		setSelectedId(workbook.id);
		setOpen(false);
	};

	const create = async (templateId: string, name: string, values: Record<string, string>) => {
		setRunning(true);
		setError(null);
		try {
			const workbook = await workbooksHandle!.methods.create({
				workspaceId,
				templateId,
				name,
				values,
			});
			setSelectedId(workbook.id);
			setCreatedId(workbook.id);
			setCreating(false);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
		setRunning(false);
	};

	const openWizard = () => {
		setError(null);
		setCreating(true);
	};

	const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setCommandValue(NO_SELECTION);
			refresh();
			setOpen(true);
		}
	};

	const workbookRow = (workbook: Workbook) => {
		const template = templates.find((candidate) => candidate.id === workbook.templateId);
		return (
			<CommandItem
				key={workbook.id}
				value={workbook.id}
				keywords={[workbook.name, templateLabel(workbook, template)]}
				data-qa-id={`workbooks-continue-${workbook.id}`}
				data-checked={workbook.id === selected?.id}
				onSelect={() => select(workbook)}
			>
				<TemplateIcon icon={template?.icon} className="text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">{workbook.name}</span>
				<span className="text-muted-foreground shrink-0 text-xs">
					{templateLabel(workbook, template)}
				</span>
			</CommandItem>
		);
	};
	// Headings only when there is a split to show.
	const grouped = here.length > 0 && elsewhere.length > 0;

	const wizard = creating ? (
		<NewWorkbookDialog
			templates={templates}
			busy={running}
			error={error}
			onClose={() => setCreating(false)}
			onCreate={(templateId, name, values) => void create(templateId, name, values)}
		/>
	) : null;

	const selectedTemplate = selected
		? templates.find((candidate) => candidate.id === selected.templateId)
		: undefined;

	return (
		<div data-qa-id="workbooks-section" className="@container flex w-full justify-center">
			<LocationCapsule data-qa-id="workbooks-row">
				<LocationField label="Workbook">
					<Popover
						open={open}
						onOpenChange={(next) => {
							if (next) {
								setCommandValue(NO_SELECTION);
								refresh();
							}
							setOpen(next);
						}}
					>
						<PopoverTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="max-w-80"
									disabled={disabled || running}
									aria-label={selected ? `Workbook: ${selected.name}` : "Choose a workbook"}
									data-qa-id="workbooks-picker-trigger"
									onKeyDown={onTriggerKeyDown}
								/>
							}
						>
							{selected ? (
								<TemplateIcon icon={selectedTemplate?.icon} />
							) : (
								<NotebookTabsIcon data-icon="inline-start" />
							)}
							<span className={cn("truncate", !selected && "text-muted-foreground")}>
								{selected ? selected.name : "Choose a workbook"}
							</span>
							<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
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
										{all.length > 0
											? "No workbooks found."
											: refreshing
												? "Looking for workbooks in Pages…"
												: refreshError
													? `Couldn't read your workbooks from Pages: ${refreshError}`
													: "No workbooks yet."}
									</CommandEmpty>
									{here.length > 0 ? (
										<CommandGroup heading={grouped ? "This workspace" : undefined}>
											{here.map(workbookRow)}
										</CommandGroup>
									) : null}
									{elsewhere.length > 0 ? (
										<CommandGroup heading={grouped ? "Other workbooks" : undefined}>
											{elsewhere.map(workbookRow)}
										</CommandGroup>
									) : null}
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
											openWizard();
										}}
									>
										<PlusIcon />
										New workbook
									</CommandItem>
								</CommandGroup>
							</Command>
						</PopoverContent>
					</Popover>
				</LocationField>
				<div role="group" aria-label="Start" className="flex items-center">
					<Button
						type="button"
						size="sm"
						disabled={!selected || disabled || running}
						title={
							selected
								? `Start a session on "${selected.name}": the new chat starts from its Brief and guide.`
								: "Choose a workbook first."
						}
						data-qa-id="workbooks-start"
						className="h-7.5 rounded-[8px]"
						onClick={() => selected && void startExisting(selected)}
					>
						Start session
						{running && !creating ? (
							<Spinner aria-hidden data-icon="inline-end" />
						) : (
							<ArrowRightIcon data-icon="inline-end" />
						)}
					</Button>
				</div>
			</LocationCapsule>
			{wizard}
		</div>
	);
}
