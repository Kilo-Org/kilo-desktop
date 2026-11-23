import { z } from "zod";

import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import { SessionWorkbooks, Workbooks, type Workbook } from "../contracts";
import { STEP_STATUSES } from "./items";
import type { PagesToolCaller } from "./pages-tools";
import { WorkbookWriter } from "./workbook-writer";

export interface WorkbookToolDeps {
	readonly pages: (workbook: Workbook) => PagesToolCaller;
	readonly today?: () => string;
}

/** The workbook tools, by contribution id; their wire names are `desktop_workbooks_<id>`. */
export const WORKBOOK_TOOL_IDS = [
	"read_workbook",
	"add_item",
	"add_task",
	"set_task_done",
	"set_status",
	"edit_step",
	"move_step",
	"remove_item",
	"supersede",
	"answer_question",
	"write_section",
	"hand_off",
] as const;

const workbookIdInput = z
	.string()
	.min(1)
	.optional()
	.describe(
		"Leave out: the chat's own workbook is used. Only for a chat outside a workbook session (e.g. a subagent): the workbook's id or its Pages project id (prj_…).",
	);

const sectionInput = z
	.string()
	.min(1)
	.describe('A section id from read_workbook, e.g. "findings".');
const stepInput = z.string().min(1).describe('The step number ("3") or words from its title.');
const fieldsInput = z
	.record(z.string(), z.string())
	.optional()
	.describe(
		'Journal sections: the section\'s labelled fields by name, e.g. { "why": "…", "rejected": "…" }.',
	);

/**
 * The agent tools that read and write the calling chat's workbook, in the
 * vocabulary of the workbook model: sections of a type (steps, checklist,
 * journal, questions, text), some with a role (goal, plan, handoff). A call
 * finds the workbook from the chat's work session (its active workbook), so
 * agents never name it; the formats and rules come from WorkbookWriter, so
 * they stay what the app expects however many agents write. Descriptions stay
 * neutral: each template's words reach agents through its sections'
 * `collects`, its Brief and its guide.
 */
export function implementWorkbookTools(sdk: PluginSdk, deps: WorkbookToolDeps): void {
	const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));

	const writerFor = (workbookId: string | undefined, context: ToolCallContext) => {
		const workbooks = sdk.domainObjects.get(Workbooks);
		const sessions = sdk.domainObjects.get(SessionWorkbooks);
		const id =
			workbookId ??
			(context.workSessionId
				? (sessions?.getState().bySession[context.workSessionId] ?? undefined)
				: undefined);
		if (!id) {
			throw new KernelError(
				"NOT_FOUND",
				"This chat has no workbook: its work session wasn't started from one. Start a session from a workbook, or pass workbookId.",
			);
		}
		const workbook = workbooks
			?.getState()
			.workbooks.find((candidate) => candidate.id === id || candidate.projectId === id);
		if (!workbook) throw new KernelError("NOT_FOUND", `No workbook "${id}".`);
		return { workbook, writer: new WorkbookWriter(deps.pages(workbook), workbook, today) };
	};

	const implement = <Input extends z.ZodType>(
		id: (typeof WORKBOOK_TOOL_IDS)[number],
		description: string,
		input: Input,
		run: (input: z.output<Input>, writer: WorkbookWriter, workbook: Workbook) => Promise<unknown>,
	) => {
		sdk.extensions.implement(
			Tool,
			id,
			defineTool({
				description,
				input,
				run: (parsed, context) => {
					const { workbookId } = parsed as { workbookId?: string };
					const { workbook, writer } = writerFor(workbookId, context);
					return run(parsed as z.output<Input>, writer, workbook);
				},
			}),
		);
	};

	implement(
		"read_workbook",
		"Read the calling chat's workbook: its sections (id, title, type, role, what each collects, a journal's fields) and the markdown of its Brief, of one section, or of its guide (\"How to work here\"). Read the Brief and guide at the start of a chat.",
		z.object({
			section: z.string().optional().describe('A section id, "guide", or omit for the Brief.'),
			workbookId: workbookIdInput,
		}),
		async ({ section }, writer, workbook) => {
			if (section === "guide" && !workbook.guidePageId) {
				throw new KernelError("NOT_FOUND", 'This workbook has no "How to work here" page.');
			}
			const target =
				section === "guide"
					? { pageId: workbook.guidePageId }
					: section
						? writer.section(section)
						: {};
			return {
				workbook: { id: workbook.id, name: workbook.name, url: workbook.url ?? null },
				sections: workbook.sections.map(({ id, title, type, role, collects, fields }) => ({
					id,
					title: title ?? null,
					type,
					...(role ? { role } : {}),
					...(collects ? { collects } : {}),
					...(fields ? { fields } : {}),
				})),
				showing: section ?? "brief",
				markdown: await writer.read(target),
			};
		},
	);

	implement(
		"add_item",
		"Add an item to a workbook section the moment it comes up, in the section's format: a step (text = title, detail = one line of intent, tasks = what it needs; numbered for you), a checklist item (detail = context), a journal entry (text = headline, detail = body, fields = the section's fields; supersedes = words from an entry it replaces, such as a reversed decision) or an open question (detail = context). Text sections use write_section; the handoff uses hand_off.",
		z.object({
			section: sectionInput,
			text: z.string().min(1),
			detail: z.string().optional(),
			tasks: z
				.array(z.string().min(1))
				.optional()
				.describe(
					'Steps: what the step needs, each a checkbox under it; end a job only the user can do with "(you)".',
				),
			fields: fieldsInput,
			who: z.string().optional().describe("Journal sections: who it's from, when that matters."),
			supersedes: z
				.string()
				.optional()
				.describe("Journal sections: words from the entry this one replaces."),
			workbookId: workbookIdInput,
		}),
		async (input, writer) => {
			const { section, workbookId: _, ...item } = input;
			return { section, ...(await writer.addItem(section, item)) };
		},
	);

	implement(
		"add_task",
		'Add a task under a plan step: a chore, a review comment ("**file or area**: issue and suggested fix") or a job only the user can do (end it with "(you)"). A task has no commit of its own; work that belongs to no step is a new step or a follow-up.',
		z.object({ step: stepInput, text: z.string().min(1), workbookId: workbookIdInput }),
		async ({ step, text }, writer) => ({ step, line: await writer.addTask(step, text) }),
	);

	implement(
		"set_task_done",
		"Tick one of a plan step's tasks when it's done (or untick it with done: false).",
		z.object({
			step: stepInput,
			task: z.string().min(1).describe("Words from the task."),
			done: z.boolean().default(true),
			workbookId: workbookIdInput,
		}),
		async ({ step, task, done }, writer) => ({
			step,
			line: await writer.setTaskDone(step, task, done),
		}),
	);

	implement(
		"set_status",
		"Set a step's status, or tick a checklist item. Steps: in_progress before starting (so others see it's taken); blocked with the reason; done with the result and the link (commit or PR), or the reason there is none, once the section's rules are met; todo resets it. Checklist items: done or todo.",
		z.object({
			section: z.string().min(1).optional().describe("Leave out for the plan's steps."),
			item: z.string().min(1).describe("A step number, or words from the step or item."),
			status: z.enum(STEP_STATUSES),
			result: z.string().optional().describe("Done steps: what was done."),
			link: z.string().optional().describe("Done steps: the commit or PR."),
			reason: z.string().optional().describe("Why it's blocked, or why a done step has no link."),
			workbookId: workbookIdInput,
		}),
		async ({ section, item, status, result, link, reason }, writer) => {
			const id = section ?? writer.withRole("plan").id;
			return {
				section: id,
				status,
				line: await writer.setStatus(id, item, {
					status,
					...(result ? { result } : {}),
					...(link ? { link } : {}),
					...(reason ? { reason } : {}),
				}),
			};
		},
	);

	implement(
		"edit_step",
		"Rename a plan step or change its intent, keeping its number, tasks and status.",
		z.object({
			step: stepInput,
			title: z.string().optional(),
			intent: z.string().optional(),
			workbookId: workbookIdInput,
		}),
		async ({ step, title, intent }, writer) => ({
			step,
			line: await writer.editStep(step, {
				...(title ? { title } : {}),
				...(intent ? { intent } : {}),
			}),
		}),
	);

	implement(
		"move_step",
		"Move a plan step (with its tasks) before or after another, when re-cutting the plan. Steps are renumbered in order; the result lists the numbers that changed, so fix any text that mentions them.",
		z.object({
			step: stepInput,
			before: z.string().optional().describe("The step to put it before."),
			after: z.string().optional().describe("The step to put it after."),
			workbookId: workbookIdInput,
		}),
		async ({ step, before, after }, writer) => ({
			renumbered: await writer.moveStep(step, {
				...(before ? { before } : {}),
				...(after ? { after } : {}),
			}),
		}),
	);

	implement(
		"remove_item",
		"Remove an item that no longer belongs: a plan step that isn't done (its tasks go with it, and later steps are renumbered), a checklist item, or a question. Journal entries are superseded instead, and done steps stay.",
		z.object({
			section: sectionInput,
			item: z.string().min(1).describe("A step number, or words from the item."),
			workbookId: workbookIdInput,
		}),
		async ({ section, item }, writer) => ({ section, ...(await writer.removeItem(section, item)) }),
	);

	implement(
		"supersede",
		"Strike a journal entry through, saying what replaced it: a finding that turned out wrong, or a decision the user reversed (to record the new decision too, use add_item with supersedes). Entries are never deleted.",
		z.object({
			section: sectionInput,
			item: z.string().min(1).describe("Words from the entry."),
			by: z.string().min(1).describe("What replaced it."),
			workbookId: workbookIdInput,
		}),
		async ({ section, item, by }, writer) => ({
			section,
			line: await writer.supersede(section, item, by),
		}),
	);

	implement(
		"answer_question",
		"When the user answers an open question: record the answer in a journal (recordIn, usually decisions; text = the decision, fields = that journal's fields) and remove the question.",
		z.object({
			question: z.string().min(1).describe("Words from the question."),
			recordIn: z.string().optional().describe("The journal section to record the answer in."),
			text: z.string().optional().describe("The answer as an entry headline, e.g. the decision."),
			detail: z.string().optional(),
			fields: fieldsInput,
			workbookId: workbookIdInput,
		}),
		async ({ question, recordIn, text, detail, fields }, writer) =>
			writer.answerQuestion(question, {
				...(recordIn ? { recordIn } : {}),
				...(text
					? { entry: { text, ...(detail ? { detail } : {}), ...(fields ? { fields } : {}) } }
					: {}),
			}),
	);

	implement(
		"write_section",
		"Replace the content of a text section (for example the context and links), keeping the line under its heading. The goal, and any protected section, changes only when the user asks: then pass userConfirmed.",
		z.object({
			section: sectionInput,
			markdown: z.string().min(1),
			userConfirmed: z.boolean().default(false),
			workbookId: workbookIdInput,
		}),
		async ({ section, markdown, userConfirmed }, writer) => {
			await writer.writeSection(section, markdown, userConfirmed);
			return { section, written: true };
		},
	);

	implement(
		"hand_off",
		"Before stopping, or when the context is running out: replace Where we left off with where the work stands (what was just done, what's next, any (you) tasks, anything a fresh chat must know); the entry is also kept in the workbook's history.",
		z.object({
			title: z.string().min(1).describe('A short headline, e.g. "Step 8 done (commit d8aef645)".'),
			text: z.string().min(1),
			who: z.string().optional().describe('Who is handing off, e.g. "agent".'),
			workbookId: workbookIdInput,
		}),
		async ({ title, text, who }, writer) => ({
			...(await writer.handOff({ headline: title, body: text, ...(who ? { who } : {}) })),
		}),
	);
}
