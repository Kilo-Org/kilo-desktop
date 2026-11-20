import { z } from "zod";

import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import { SessionWorkbooks, Workbooks, type Workbook } from "../contracts";
import type { PagesToolCaller } from "./pages-tools";
import { STEP_STATUSES, WorkbookWriter } from "./workbook-writer";

export interface WorkbookToolDeps {
	readonly pages: (workbook: Workbook) => PagesToolCaller;
	readonly today?: () => string;
}

/** The workbook tools, by contribution id; their wire names are `desktop_workbooks_<id>`. */
export const WORKBOOK_TOOL_IDS = [
	"read_workbook",
	"add_plan_step",
	"set_step_status",
	"record_decision",
	"file_item",
	"set_where_i_left_off",
] as const;

const workbookIdInput = z
	.string()
	.min(1)
	.optional()
	.describe(
		"Leave out: the chat's own workbook is used. Only for a chat outside a workbook session (e.g. a subagent): the workbook's id or its Pages project id (prj_…).",
	);

/**
 * The agent tools that read and write the calling chat's workbook. A call
 * finds the workbook from the chat's work session (its active workbook), so
 * agents never name it; the formats come from WorkbookWriter, so they stay
 * what the guide and the app expect however many agents write.
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

	sdk.extensions.implement(
		Tool,
		"read_workbook",
		defineTool({
			description:
				'Read the calling chat\'s workbook: its sections (id, title, item type) and the markdown of its Brief, of one section, or of its guide ("How to work here"). Read the Brief and guide at the start of a chat.',
			input: z.object({
				section: z
					.string()
					.optional()
					.describe('A section id (e.g. "plan"), "guide", or omit for the Brief.'),
				workbookId: workbookIdInput,
			}),
			run: async ({ section, workbookId }, context) => {
				const { workbook, writer } = writerFor(workbookId, context);
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
					sections: workbook.sections.map(({ id, title, itemType }) => ({ id, title, itemType })),
					showing: section ?? "brief",
					markdown: await writer.read(target),
				};
			},
		}),
	);

	sdk.extensions.implement(
		Tool,
		"add_plan_step",
		defineTool({
			description:
				"Add a step to the end of the workbook's Plan, sized for one chat. It is numbered for you.",
			input: z.object({
				title: z.string().min(1).describe('Short title, e.g. "Template registry".'),
				intent: z.string().min(1).describe("One line on what the step achieves."),
				workbookId: workbookIdInput,
			}),
			run: async ({ title, intent, workbookId }, context) => {
				const { writer } = writerFor(workbookId, context);
				return { section: "plan", step: await writer.addPlanStep(title, intent) };
			},
		}),
	);

	sdk.extensions.implement(
		Tool,
		"set_step_status",
		defineTool({
			description:
				"Set a Plan step's status. in_progress before starting it (so others see it's taken); done ticks it and records the outcome; blocked records why; todo resets it.",
			input: z.object({
				step: z.string().min(1).describe('The step number ("3") or words from its title.'),
				status: z.enum(STEP_STATUSES),
				note: z
					.string()
					.optional()
					.describe("Required for done (the outcome, with the commit or PR) and blocked (why)."),
				workbookId: workbookIdInput,
			}),
			run: async ({ step, status, note, workbookId }, context) => {
				const { writer } = writerFor(workbookId, context);
				return { section: "plan", status, line: await writer.setStepStatus(step, status, note) };
			},
		}),
	);

	sdk.extensions.implement(
		Tool,
		"record_decision",
		defineTool({
			description:
				"Record a decision the user made or confirmed (never your own suggestion until they confirm it), with why and the alternatives rejected.",
			input: z.object({
				decision: z.string().min(1),
				why: z.string().min(1),
				rejected: z.string().optional(),
				workbookId: workbookIdInput,
			}),
			run: async ({ decision, why, rejected, workbookId }, context) => {
				const { writer } = writerFor(workbookId, context);
				return { section: "decisions", line: await writer.recordDecision(decision, why, rejected) };
			},
		}),
	);

	sdk.extensions.implement(
		Tool,
		"file_item",
		defineTool({
			description:
				"File an item in a workbook section the moment it comes up, formatted for that section: a task or follow-up (detail = context), finding (detail = evidence), open question (detail = context), artifact (text = kind: link, detail = note), snippet (text = title, detail = the code or command) or note. Use read_workbook to see the section ids.",
			input: z.object({
				section: z
					.string()
					.min(1)
					.describe('The section id, e.g. "tasks", "findings" or "questions".'),
				text: z.string().min(1),
				detail: z.string().optional(),
				workbookId: workbookIdInput,
			}),
			run: async ({ section, text, detail, workbookId }, context) => {
				const { writer } = writerFor(workbookId, context);
				return { section, written: await writer.fileItem(section, text, detail) };
			},
		}),
	);

	sdk.extensions.implement(
		Tool,
		"set_where_i_left_off",
		defineTool({
			description:
				"Replace the Brief's \"Where I left off\": what was just done, what's next, and anything a fresh chat must know. Do this before stopping or when the context is running out.",
			input: z.object({ text: z.string().min(1), workbookId: workbookIdInput }),
			run: async ({ text, workbookId }, context) => {
				const { writer } = writerFor(workbookId, context);
				return { section: "brief", line: await writer.setWhereILeftOff(text) };
			},
		}),
	);
}
