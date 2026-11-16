import { NotebookPenIcon, NotebookTabsIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import type { NewWorkSessionSectionProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import {
	SessionWorkbooks,
	WorkbookTemplates,
	Workbooks,
	workbooksIn,
	type TemplateSummary,
	type Workbook,
} from "../contracts";
import { ContinueWorkbookDialog } from "./ContinueWorkbookDialog";
import { NewWorkbookDialog } from "./NewWorkbookDialog";
import { startFromWorkbook, startNewWorkbook, type StartDeps } from "./start";

const selectWorkbooks = (state: { workbooks: Workbook[] }) => state.workbooks;
const selectTemplates = (state: { templates: TemplateSummary[] }) => state.templates;

type Open = "new" | "continue" | null;

/**
 * Workbooks on the New Session page (`kilo.work-sessions/new-work-session-section`):
 * two tiles in the style of the page's tool tiles, "New workbook" and (when
 * the workspace has any) "Continue a workbook", each opening its dialog. The
 * session starts where the page says (workspace, isolation) and opens with
 * the kick-off in its composer, unsent; the dialog closes once it has.
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
	const [open, setOpen] = useState<Open>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const show = (dialog: Open) => {
		setError(null);
		setOpen(dialog);
	};
	const run = async (starting: () => Promise<unknown>) => {
		setRunning(true);
		setError(null);
		try {
			await starting();
			setOpen(null);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setRunning(false);
		}
	};

	if (workspaceId === null) return null;
	return (
		<div
			data-qa-id="workbooks-section"
			className="grid w-full grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2"
		>
			<WorkbookTile
				Icon={NotebookPenIcon}
				title="New workbook"
				description="Start a session from a new workbook: pick a template and fill in its Brief."
				qaId="workbooks-new"
				disabled={disabled || templates.length === 0}
				starting={running && open === "new"}
				onClick={() => show("new")}
			/>
			{workbooks.length > 0 ? (
				<WorkbookTile
					Icon={NotebookTabsIcon}
					title="Continue a workbook"
					description="Start a session where a workbook in this workspace left off."
					qaId="workbooks-continue"
					disabled={disabled}
					starting={running && open === "continue"}
					onClick={() => show("continue")}
				/>
			) : null}
			{open === "new" ? (
				<NewWorkbookDialog
					templates={templates}
					busy={running}
					error={error}
					onClose={() => setOpen(null)}
					onCreate={(templateId, name, values) =>
						run(() => startNewWorkbook(deps, { workspaceId, templateId, name, values }))
					}
				/>
			) : null}
			{open === "continue" ? (
				<ContinueWorkbookDialog
					workbooks={workbooks}
					handle={deps.workbooks}
					busy={running}
					error={error}
					onClose={() => setOpen(null)}
					onStart={(workbook, { focus }) =>
						run(() =>
							startFromWorkbook(deps, { workbookId: workbook.id, ...(focus ? { focus } : {}) }),
						)
					}
				/>
			) : null}
		</div>
	);
}

/** A tile in the style of the New Session page's tool tiles; what it does is the tooltip. */
function WorkbookTile({
	Icon,
	title,
	description,
	qaId,
	disabled,
	starting,
	onClick,
}: {
	readonly Icon: LucideIcon;
	readonly title: string;
	readonly description: string;
	readonly qaId: string;
	readonly disabled: boolean;
	readonly starting: boolean;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			title={description}
			data-qa-id={qaId}
			className="bg-muted/60 hover:bg-muted focus-visible:ring-ring/50 disabled:hover:bg-muted/60 flex h-11 min-w-0 items-center gap-1.5 rounded-[10px] ps-3 pe-2 text-start text-[13px] transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
			onClick={onClick}
		>
			{starting ? (
				<Spinner aria-hidden className="size-3.5 shrink-0" />
			) : (
				<Icon className="size-3.5 shrink-0" />
			)}
			<span className="whitespace-nowrap">{title}</span>
		</button>
	);
}
