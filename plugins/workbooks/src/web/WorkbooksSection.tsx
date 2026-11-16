import { useState, type FormEvent } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Composer } from "@kilo-desktop/plugin-chat/contracts";
import type { NewWorkSessionSectionProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Input } from "@kilo-desktop/ui/components/input";
import { Label } from "@kilo-desktop/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kilo-desktop/ui/components/tabs";
import { Textarea } from "@kilo-desktop/ui/components/textarea";

import {
	SessionWorkbooks,
	WorkbookTemplates,
	Workbooks,
	workbooksIn,
	type TemplateSummary,
	type Workbook,
} from "../contracts";
import { ResumeWorkbook } from "./ResumeWorkbook";
import { startFromWorkbook, startNewWorkbook, type StartDeps } from "./start";

const selectWorkbooks = (state: { workbooks: Workbook[] }) => state.workbooks;
const selectTemplates = (state: { templates: TemplateSummary[] }) => state.templates;

/**
 * "Start from a workbook" on the New Session page
 * (`kilo.work-sessions/new-work-session-section`): continue a workbook in the
 * workspace, seeing where it's at first, or create one from a template by
 * filling in its Brief. The session starts where the page says (workspace,
 * isolation) and opens with the kick-off in its composer, unsent.
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
	const [running, setRunning] = useState(false);
	const [resuming, setResuming] = useState<Workbook | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busy = running || disabled;

	const run = async (starting: () => Promise<unknown>) => {
		setRunning(true);
		setError(null);
		try {
			await starting();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setRunning(false);
		}
	};

	if (workspaceId === null) return null;
	return (
		<section
			aria-labelledby="workbooks-section-title"
			data-qa-id="workbooks-section"
			className="border-border/60 flex w-full flex-col gap-3 rounded-xl border p-4"
		>
			<div className="flex flex-col gap-0.5">
				<h2 id="workbooks-section-title" className="text-sm font-medium">
					Start from a workbook
				</h2>
				<p className="text-muted-foreground text-xs">
					A workbook keeps what your chats learn and decide, so a new chat starts from it instead of
					from pasted text.
				</p>
			</div>
			<Tabs defaultValue={workbooks.length > 0 ? "continue" : "new"}>
				<TabsList>
					<TabsTrigger value="continue" data-qa-id="workbooks-tab-continue">
						Continue a workbook
					</TabsTrigger>
					<TabsTrigger value="new" data-qa-id="workbooks-tab-new">
						New from template
					</TabsTrigger>
				</TabsList>
				<TabsContent value="continue">
					{resuming ? (
						<ResumeWorkbook
							workbook={resuming}
							workbooks={deps.workbooks}
							busy={busy}
							onBack={() => setResuming(null)}
							onStart={({ focus }) =>
								run(() =>
									startFromWorkbook(deps, {
										workbookId: resuming.id,
										...(focus ? { focus } : {}),
									}),
								)
							}
						/>
					) : (
						<ContinueWorkbook workbooks={workbooks} onPick={setResuming} />
					)}
				</TabsContent>
				<TabsContent value="new">
					<NewWorkbook
						templates={templates}
						busy={busy}
						onCreate={(templateId, name, values) =>
							run(() => startNewWorkbook(deps, { workspaceId, templateId, name, values }))
						}
					/>
				</TabsContent>
			</Tabs>
			{error ? (
				<p role="alert" className="text-destructive text-sm" data-qa-id="workbooks-start-error">
					{error}
				</p>
			) : null}
		</section>
	);
}

function ContinueWorkbook({
	workbooks,
	onPick,
}: {
	readonly workbooks: readonly Workbook[];
	readonly onPick: (workbook: Workbook) => void;
}) {
	if (workbooks.length === 0) {
		return (
			<p className="text-muted-foreground py-4 text-sm" data-qa-id="workbooks-none">
				No workbooks in this workspace yet. Create one from a template.
			</p>
		);
	}
	return (
		<ul className="flex flex-col gap-1 py-2" data-qa-id="workbooks-list">
			{workbooks.map((workbook) => (
				<li key={workbook.id} className="flex items-center justify-between gap-2">
					<span className="truncate text-sm">{workbook.name}</span>
					<Button
						type="button"
						size="sm"
						variant="outline"
						data-qa-id={`workbooks-continue-${workbook.id}`}
						onClick={() => onPick(workbook)}
					>
						Open
					</Button>
				</li>
			))}
		</ul>
	);
}

function NewWorkbook({
	templates,
	busy,
	onCreate,
}: {
	readonly templates: readonly TemplateSummary[];
	readonly busy: boolean;
	readonly onCreate: (templateId: string, name: string, values: Record<string, string>) => void;
}) {
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [name, setName] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const template = templates.find((candidate) => candidate.id === templateId) ?? templates[0];
	if (!template) {
		return (
			<p className="text-muted-foreground py-4 text-sm">No workbook templates are available.</p>
		);
	}
	const missing = template.fields.some((field) => field.required && !values[field.id]?.trim());
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onCreate(template.id, name.trim(), values);
	};
	return (
		<form className="flex flex-col gap-3 py-2" onSubmit={submit} data-qa-id="workbooks-new-form">
			{templates.length > 1 ? (
				<div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Template">
					{templates.map((candidate) => (
						<Button
							key={candidate.id}
							type="button"
							size="sm"
							variant={candidate.id === template.id ? "secondary" : "ghost"}
							role="radio"
							aria-checked={candidate.id === template.id}
							data-qa-id={`workbooks-template-${candidate.id}`}
							onClick={() => setTemplateId(candidate.id)}
						>
							{candidate.name}
						</Button>
					))}
				</div>
			) : null}
			<p className="text-muted-foreground text-xs">{template.description}</p>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="workbook-name">Name</Label>
				<Input
					id="workbook-name"
					value={name}
					placeholder="e.g. Fix the bug in the Kilo server"
					data-qa-id="workbooks-name"
					onChange={(event) => setName(event.target.value)}
				/>
			</div>
			{template.fields.map((field) => (
				<div key={field.id} className="flex flex-col gap-1.5">
					<Label htmlFor={`workbook-field-${field.id}`}>
						{field.label}
						{field.required ? " (required)" : ""}
					</Label>
					<Textarea
						id={`workbook-field-${field.id}`}
						rows={field.required ? 3 : 2}
						placeholder={field.hint}
						value={values[field.id] ?? ""}
						data-qa-id={`workbooks-field-${field.id}`}
						onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
					/>
				</div>
			))}
			<div className="flex justify-end">
				<Button
					type="submit"
					disabled={busy || missing || !name.trim()}
					data-qa-id="workbooks-create"
				>
					{busy ? "Creating…" : "Create and start"}
				</Button>
			</div>
		</form>
	);
}
