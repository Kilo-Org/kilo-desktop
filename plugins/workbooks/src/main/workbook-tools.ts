import { z } from "zod";

import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import { WorkSessions } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	STEP_STATUSES,
	SessionWorkbooks,
	Workbooks,
	sectionUsage,
	type Workbook,
} from "../contracts";
import type { PagesToolCaller } from "./pages-tools";
import { stepParts } from "./inserts/plan";
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
	"set_activity",
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

/**
 * The agent tools that read and write the calling chat's workbook, in the
 * vocabulary of the workbook model: sections, each one insert (goal, plan,
 * handoff, activity, todo, log, questions, notes, output). A call
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

	/** Who the calling chat is, for the activity section: its work session's title. */
	const agentName = (context: ToolCallContext): string => {
		const session = context.workSessionId
			? sdk.domainObjects
					.get(WorkSessions)
					?.getState()
					.workSessions.find((candidate) => candidate.id === context.workSessionId)
			: undefined;
		return session?.title || (context.chatId ? `Chat ${context.chatId.slice(-6)}` : "Agent");
	};

	/** Updates the caller's activity line; never fails the tool call it follows. */
	const noteActivity = async (writer: WorkbookWriter, who: string, doing: string | undefined) => {
		await writer.setActivity(who, doing).catch((error: unknown) => {
			sdk.logger.warn(`Couldn't update the workbook's activity: ${String(error)}`);
		});
	};

	const implement = <Input extends z.ZodType>(
		id: (typeof WORKBOOK_TOOL_IDS)[number],
		description: string,
		input: Input,
		run: (
			input: z.output<Input>,
			writer: WorkbookWriter,
			workbook: Workbook,
			who: string,
		) => Promise<unknown>,
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
					return run(parsed as z.output<Input>, writer, workbook, agentName(context));
				},
			}),
		);
	};

	implement(
		"read_workbook",
		'Read the calling chat\'s workbook: its sections (id, title, section type, what each collects, how to work with it) and the markdown of its Brief, of one section, or of its guide ("How to work here"). Read the Brief and guide at the start of a chat.',
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
				sections: workbook.sections.map(({ id, title, type, collects, instructions }) => ({
					usage: sectionUsage({ type, instructions }),
					id,
					title: title ?? null,
					type,
					...(collects ? { collects } : {}),
				})),
				showing: section ?? "brief",
				markdown: await writer.read(target),
			};
		},
	);

	implement(
		"add_item",
		"Add an item to a workbook section the moment it comes up, in the section's format: a plan step (text = title, detail = one line of intent, tasks = what it needs; numbered for you), a todo item (detail = context), a log entry (text = headline, detail = the rest, with what the section's description asks for; supersedes = words from an entry it replaces, such as a reversed decision) a question (detail = context), or a new part of an output (text = the part's title, detail = its content). Goal and notes sections use write_section; handoff uses hand_off; activity uses set_activity.",
		z.strictObject({
			section: sectionInput,
			text: z.string().min(1),
			detail: z.string().optional(),
			tasks: z
				.array(z.string().min(1))
				.optional()
				.describe(
					'Steps: what the step needs, each a checkbox under it; end a job only the user can do with "(you)".',
				),
			who: z.string().optional().describe("Log sections: who it's from, when that matters."),
			supersedes: z
				.string()
				.optional()
				.describe("Log sections: words from the entry this one replaces."),
			workbookId: workbookIdInput,
		}),
		async (input, writer) => {
			const { section, workbookId: _, ...item } = input;
			return { section, ...(await writer.addItem(section, item)) };
		},
	);

	implement(
		"add_task",
		'Add a task under a plan step: a chore, a review comment ("**file or area**: issue and suggested fix") or a job only the user can do (end it with "(you)"). A task is part of its step; work that belongs to no step is a new step or a follow-up.',
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
		"Set a plan step's status, or tick a todo item. Steps: in_progress before starting (so others see it's taken); blocked with the reason; done once its tasks are ticked, with what it achieved (result) and optionally a link to it; todo resets it. Todo items: done or todo.",
		z.object({
			section: z.string().min(1).optional().describe("Leave out for the plan's steps."),
			item: z.string().min(1).describe("A step number, or words from the step or item."),
			status: z.enum(STEP_STATUSES),
			result: z.string().optional().describe("Done steps: what was done."),
			link: z.string().optional().describe("Done steps: a link to what it produced."),
			reason: z.string().optional().describe("Why it's blocked."),
			workbookId: workbookIdInput,
		}),
		async ({ section, item, status, result, link, reason }, writer, _workbook, who) => {
			const target = section ? writer.section(section) : writer.only("plan");
			const line = await writer.setStatus(target.id, item, {
				status,
				...(result ? { result } : {}),
				...(link ? { link } : {}),
				...(reason ? { reason } : {}),
			});
			if (target.type === "plan") {
				const step = stepParts(line);
				const name = step ? `step ${step.number}, ${step.title}` : `step ${item}`;
				await noteActivity(
					writer,
					who,
					status === "in_progress"
						? `working on ${name}`
						: status === "blocked"
							? `blocked on ${name}: ${reason}`
							: undefined,
				);
			}
			return { section: target.id, status, line };
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
		"Remove an item that no longer belongs: a plan step that isn't done (its tasks go with it, and later steps are renumbered), a todo item, or a question. Log entries are superseded instead, and done steps stay.",
		z.object({
			section: sectionInput,
			item: z.string().min(1).describe("A step number, or words from the item."),
			workbookId: workbookIdInput,
		}),
		async ({ section, item }, writer) => ({ section, ...(await writer.removeItem(section, item)) }),
	);

	implement(
		"supersede",
		"Strike a log entry through, saying what replaced it: a finding that turned out wrong, or a decision the user reversed (to record the new decision too, use add_item with supersedes). Entries are never deleted.",
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
		"When the user answers an open question: record the answer in a log (recordIn, e.g. decisions; text = the answer as a headline, detail = the rest), as the questions section's instructions say, and remove the question.",
		z.object({
			question: z.string().min(1).describe("Words from the question."),
			recordIn: z.string().optional().describe("The log section to record the answer in."),
			text: z.string().optional().describe("The answer as an entry headline, e.g. the decision."),
			detail: z.string().optional(),
			workbookId: workbookIdInput,
		}),
		async ({ question, recordIn, text, detail }, writer) =>
			writer.answerQuestion(question, {
				...(recordIn ? { recordIn } : {}),
				...(text ? { entry: { text, ...(detail ? { detail } : {}) } } : {}),
			}),
	);

	implement(
		"write_section",
		"Write a goal, notes or output section, keeping the line under its heading. Goal and notes are replaced whole. An output is the result being built: pass part to improve (or add) one part, or leave it out to rewrite the whole. The goal changes only when the user asks: then pass userConfirmed.",
		z.object({
			section: sectionInput,
			markdown: z.string().min(1),
			part: z.string().optional().describe("Output sections: the title of the part to write."),
			userConfirmed: z.boolean().default(false),
			workbookId: workbookIdInput,
		}),
		async ({ section, markdown, part, userConfirmed }, writer) => ({
			section,
			written: true,
			...(await writer.writeSection(section, markdown, {
				userConfirmed,
				...(part ? { part } : {}),
			})),
		}),
	);

	implement(
		"hand_off",
		"Before stopping, or when the context is running out: replace Where we left off with where the work stands (what was just done, what's next, any (you) tasks, anything a fresh chat must know); the entry is also kept in the change log.",
		z.object({
			title: z.string().min(1).describe('A short headline, e.g. "Step 8 done".'),
			text: z.string().min(1),
			who: z.string().optional().describe('Who is handing off, e.g. "agent".'),
			workbookId: workbookIdInput,
		}),
		async ({ title, text, who }, writer, _workbook, agent) => {
			const result = await writer.handOff({ headline: title, body: text, ...(who ? { who } : {}) });
			await noteActivity(writer, agent, undefined);
			return result;
		},
	);

	implement(
		"set_activity",
		"Say what you're working on, so the user and other agents can see it in the workbook's activity section: for work that isn't a plan step (starting, blocking and finishing plan steps update it for you). Leave doing out to say you've stopped.",
		z.object({
			doing: z.string().optional().describe('e.g. "reviewing PR #42"; leave out when you stop.'),
			workbookId: workbookIdInput,
		}),
		async ({ doing }, writer, workbook, who) => {
			if (!workbook.sections.some((section) => section.type === "activity")) {
				throw new KernelError("NOT_FOUND", "This workbook has no activity section.");
			}
			return { who, line: (await writer.setActivity(who, doing)) ?? null };
		},
	);
}
