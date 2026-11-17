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
import { startFromWorkbook, startNewWorkbook, type StartDeps } from "./start";
import { templateIcon } from "./template-icons";

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

/** The New Session page's tool-tile look. */
const TILE =
	"bg-muted/60 hover:bg-muted focus-visible:ring-ring/50 disabled:hover:bg-muted/60 flex h-11 min-w-0 items-center gap-1.5 rounded-[10px] ps-3 pe-2 text-start text-[13px] transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

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
 * every workbook, those used in the page's workspace first, then "New
 * workbook" pinned under the list, which opens the New workbook wizard. The
 * list is the last one found in Pages, refreshed when the section shows and
 * each time the picker opens.
 * Workbooks aren't tied to a workspace, so the tile shows with or without
 * one. Picking a workbook selects it (the tile then names it) and shows a
 * "Start session" tile beside it: the go action, which starts the session
 * where the page says (workspace, isolation), its composer holding the
 * kick-off, unsent. A failure is a toast.
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
	// A forgotten workbook is no selection.
	const selected = all.find((workbook) => workbook.id === selectedId) ?? null;
	const [error, setError] = useState<string | null>(null);

	const startExisting = async (workbook: Workbook) => {
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

	const select = (workbook: Workbook) => {
		setSelectedId(workbook.id);
		setOpen(false);
	};

	const create = async (templateId: string, name: string, values: Record<string, string>) => {
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
			setCommandValue(NO_SELECTION);
			refresh();
			setOpen(true);
		}
	};

	const workbookRow = (workbook: Workbook) => {
		const template = templates.find((candidate) => candidate.id === workbook.templateId);
		const Icon = templateIcon(template?.icon);
		return (
			<CommandItem
				key={workbook.id}
				value={workbook.id}
				keywords={[workbook.name, templateLabel(workbook, template)]}
				data-qa-id={`workbooks-continue-${workbook.id}`}
				data-checked={workbook.id === selected?.id}
				onSelect={() => select(workbook)}
			>
				<Icon className="text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">{workbook.name}</span>
				<span className="text-muted-foreground shrink-0 text-xs">
					{templateLabel(workbook, template)}
				</span>
			</CommandItem>
		);
	};
	// Headings only when there is a split to show.
	const grouped = here.length > 0 && elsewhere.length > 0;

	return (
		<div
			data-qa-id="workbooks-section"
			className="grid w-full grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2"
		>
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
						<button
							type="button"
							disabled={disabled || running}
							title="Choose a workbook, or start a new one."
							aria-label={selected ? `Workbook: ${selected.name}` : "Choose a workbook"}
							data-qa-id="workbooks-picker-trigger"
							onKeyDown={onTriggerKeyDown}
							className={cn(TILE, "aria-expanded:bg-muted")}
						/>
					}
				>
					{(() => {
						const Icon = selected
							? templateIcon(
									templates.find((candidate) => candidate.id === selected.templateId)?.icon,
								)
							: NotebookTabsIcon;
						return <Icon className="size-3.5 shrink-0" />;
					})()}
					<span className={cn("min-w-0 truncate", !selected && "whitespace-nowrap")}>
						{selected ? selected.name : "Workbook"}
					</span>
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
			{selected ? (
				<button
					type="button"
					disabled={disabled || running}
					title={`Start a session on "${selected.name}": the new chat starts from its Brief and guide.`}
					data-qa-id="workbooks-start"
					className={TILE}
					onClick={() => void startExisting(selected)}
				>
					{running ? (
						<Spinner aria-hidden className="size-3.5 shrink-0" />
					) : (
						<ArrowRightIcon className="size-3.5 shrink-0" />
					)}
					<span className="whitespace-nowrap">Start session</span>
				</button>
			) : null}
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
