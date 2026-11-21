import { ChevronDownIcon, NotebookTabsIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import type {
	NewWorkSession,
	NewWorkSessionSetting,
	NewWorkSessionSettingProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
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
import { LocationField } from "@kilo-desktop/ui/components/location-capsule";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
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
import { TemplateIcon } from "./template-icons";
import type { WorkbookSelection } from "./workbook-selection";

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
const NO_WORKBOOK = "no-workbook";

// Rows carry the workbook's name and template as keywords, so search never matches the id.
function filterByKeywords(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

/**
 * The workbook a new work session works in, as a `new-work-session-setting`:
 * a "Workbook" segment ending the New Session page's location row, with a
 * searchable picker built to the dropdown standard (as the workspace picker:
 * every workbook, those used in the page's workspace first; "No workbook" to
 * clear it; "New workbook" pinned under the list, which opens the wizard and
 * selects the workbook it makes). Choosing starts nothing: whatever the page
 * then starts (a first message, a tool, an empty session) is set to work in
 * the workbook before it opens, so its chats are given the workbook's
 * instructions (its Brief and guide). Choosing one also suggests the first
 * message in the New Session draft, short and editable: the template's first
 * move for a workbook just made here, otherwise carry on from where it was
 * left; it never replaces what the person typed, and goes again with "No
 * workbook". The list is the last one found in Pages, refreshed when the
 * setting shows and each time the picker opens.
 */
export function workbookSetting(
	sdk: PluginSdk,
	selection: WorkbookSelection,
): NewWorkSessionSetting {
	return {
		component: (props) => <WorkbookSetting {...props} selection={selection} />,
		apply: (session) => applyWorkbook(sdk, selection, session),
	};
}

/** Puts a session the page just started in the chosen workbook, when one is chosen and still there. */
async function applyWorkbook(
	sdk: PluginSdk,
	selection: WorkbookSelection,
	session: NewWorkSession,
) {
	const workbookId = selection.get();
	if (!workbookId || !sdk.domainObjects.get(Workbooks)?.lookup(workbookId)) return;
	const sessions = sdk.domainObjects.get(SessionWorkbooks);
	if (!sessions) throw new KernelError("UNAVAILABLE", "Workbooks aren't available.");
	await sessions.methods.setActive({ workSessionId: session.workSessionId, workbookId });
	selection.fresh.delete(workbookId);
}

const DEFAULT_FIRST_MOVE =
	"Refine the Brief and draft the Plan, then stop for me to confirm before building.";

/** The first message suggested for a session on the workbook. */
export function suggestedFirstMessage(
	workbook: Workbook,
	template: TemplateSummary | undefined,
	fresh: boolean,
): string {
	if (fresh) {
		// A template summary from a main process older than the window carries no first move.
		const firstMove = (template?.firstMove as string | undefined)?.trim() || DEFAULT_FIRST_MOVE;
		return `Let's start the workbook "${workbook.name}". ${firstMove}`;
	}
	return `Let's carry on with workbook "${workbook.name}": say where we left off and what's next.`;
}

function WorkbookSetting({
	workspaceId,
	disabled,
	selection,
}: NewWorkSessionSettingProps & { readonly selection: WorkbookSelection }) {
	const workbooksHandle = useDomainObject(Workbooks);
	const all = useDomainObjectState(Workbooks, selectWorkbooks) ?? [];
	const refreshing = useDomainObjectState(Workbooks, selectRefreshing) ?? false;
	const refreshError = useDomainObjectState(Workbooks, selectRefreshError) ?? null;
	const { here, elsewhere } = workbooksFor(all, workspaceId);
	const refresh = () => void workbooksHandle?.methods.refresh(undefined);
	useEffect(() => {
		void workbooksHandle?.methods.refresh(undefined);
	}, [workbooksHandle]);
	const templates = useDomainObjectState(WorkbookTemplates, selectTemplates) ?? [];
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(NO_SELECTION);
	const [creating, setCreating] = useState(false);
	const [running, setRunning] = useState(false);
	const selectedId = useSyncExternalStore(selection.subscribe, selection.get, selection.get);
	// A forgotten workbook is no selection.
	const selected = all.find((workbook) => workbook.id === selectedId) ?? null;
	const [error, setError] = useState<string | null>(null);
	const composer = useDomainObject(Composer);
	const selectedTemplate = selected
		? templates.find((candidate) => candidate.id === selected.templateId)
		: undefined;
	const suggestion = selected
		? suggestedFirstMessage(selected, selectedTemplate, selection.fresh.has(selected.id))
		: "";
	// Shown again on each visit to the page, until the person types their own.
	useEffect(() => {
		if (!composer || (!suggestion && !selection.suggestion)) return;
		const replacing = selection.suggestion;
		void composer.methods
			.prefillNewSession({ text: suggestion, ...(replacing ? { replacing } : {}) })
			.then((set) => {
				if (set) selection.suggestion = suggestion || undefined;
			})
			.catch(() => undefined);
	}, [composer, selection, suggestion]);

	const select = (workbook: Workbook) => {
		selection.set(workbook.id);
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
			selection.fresh.add(workbook.id);
			selection.set(workbook.id);
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

	return (
		<>
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
							{selected ? selected.name : "None"}
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
							{/* Outside the list, so they must opt out of cmdk hiding them while filtering. */}
							<CommandSeparator alwaysRender />
							<CommandGroup forceMount>
								{selected ? (
									<CommandItem
										value={NO_WORKBOOK}
										data-qa-id="workbooks-none"
										onSelect={() => {
											selection.set(null);
											setOpen(false);
										}}
									>
										<XIcon />
										No workbook
									</CommandItem>
								) : null}
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
			{wizard}
		</>
	);
}
