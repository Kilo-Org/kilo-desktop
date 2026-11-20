import { KernelError } from "@kilo-desktop/kernel";

import { STEP_STATUSES, type Workbook, type WorkbookSectionRef } from "../contracts";
import type { PagesToolCaller } from "./pages-tools";
import { sectionScope, type Block, type Line } from "./section-scope";

/** Where to read or write: a page (the Brief without one), and a section's heading on it. */
type Target = Pick<WorkbookSectionRef, "pageId" | "heading">;

interface ReadPage {
	readonly revision: string;
	readonly blocks: readonly Block[];
}

export { STEP_STATUSES };
export type StepStatus = (typeof STEP_STATUSES)[number];

const TASK_LINE = /^(\s*)- \[([ xX])\] (.*)$/;
/** A plan step: a top-level checkbox item, never one of a step's (indented) tasks. */
const STEP_LINE = /^- \[[ xX]\] /;
const TASK_INDENT = "  ";
const LIST_LINE = /^\s*- /;
const TRAILING_DATE = /\s*\(\d{4}-\d{2}-\d{2}\)[.\s]*$/;
const STATUS_SUFFIX = / · (in progress|blocked:.*|done:.*)$/;
const STEP_NUMBER = /^\*\*(\d+)\./;
const INDENTED = /^(\s+)\S/;

/**
 * Writes workbook items into Pages in the formats the guide defines, so agents
 * never hand-edit them. A section is a page, or the part of a page (or of the
 * Brief) under its heading; reads and writes stay within it, and a missing
 * heading is added at the end of the page. Every write reads the page first
 * and sends its revision; a write that loses a race with another writer is
 * retried once on the fresh page, which is enough for concurrent agents
 * appending items.
 */
export class WorkbookWriter {
	constructor(
		private readonly pages: PagesToolCaller,
		private readonly workbook: Workbook,
		private readonly today: () => string,
	) {}

	section(id: string): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.id === id);
		if (!section) {
			const ids = this.workbook.sections.map((candidate) => candidate.id).join(", ");
			throw new KernelError("NOT_FOUND", `This workbook has no "${id}" section (it has: ${ids}).`);
		}
		return section;
	}

	sectionFor(itemType: WorkbookSectionRef["itemType"]): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.itemType === itemType);
		if (!section)
			throw new KernelError("NOT_FOUND", `This workbook has no section for ${itemType}s.`);
		return section;
	}

	async read(target: Target): Promise<string> {
		const page = await this.#read(target);
		if (!target.heading) {
			return page.blocks
				.map((block) => block.markdown ?? "")
				.join("\n\n")
				.trim();
		}
		return sectionScope(page.blocks, target.heading)
			.lines.map((line) => line.text)
			.join("\n")
			.trim();
	}

	/** Adds a plan step, numbered after the last one, with its tasks under it. Returns its number. */
	async addPlanStep(title: string, intent: string, tasks: readonly string[] = []): Promise<number> {
		const plan = this.sectionFor("plan-step");
		let number = 0;
		await this.#appendListItem(plan, (lines) => {
			number = Math.max(0, ...lines.map(stepNumber)) + 1;
			return [
				`- [ ] **${number}. ${oneLine(title)}**: ${oneLine(intent)}`,
				...tasks
					.filter((task) => task.trim())
					.map((task) => `${TASK_INDENT}- [ ] ${oneLine(task)}`),
			].join("\n");
		});
		return number;
	}

	/** Adds a task under a plan step, after its other tasks. Returns the task's line. */
	async addTask(step: string, text: string): Promise<string> {
		return this.#withStep(step, (lines, at) => {
			const tasks = stepTasks(lines, at);
			const indent = tasks.length > 0 ? INDENTED.exec(lines[tasks.at(-1)!]!)![1]! : TASK_INDENT;
			const line = `${indent}- [ ] ${oneLine(text)}`;
			lines.splice((tasks.at(-1) ?? at) + 1, 0, line);
			return line;
		});
	}

	/** Ticks (or unticks) one of a plan step's tasks, found by words from it. Returns its line. */
	async setTaskDone(step: string, task: string, done: boolean): Promise<string> {
		return this.#withStep(step, (lines, at) => {
			const wanted = oneLine(task).toLowerCase();
			const matches = stepTasks(lines, at).filter((index) =>
				lines[index]!.toLowerCase().includes(wanted),
			);
			if (matches.length !== 1) {
				throw new KernelError(
					matches.length === 0 ? "NOT_FOUND" : "VALIDATION",
					matches.length === 0
						? `Step ${step} has no task matching "${task}".`
						: `"${task}" matches ${matches.length} of step ${step}'s tasks; use more of its words.`,
				);
			}
			const index = matches[0]!;
			lines[index] = lines[index]!.replace(/^(\s*)- \[[ xX]\]/, `$1- [${done ? "x" : " "}]`);
			return lines[index]!;
		});
	}

	/** Sets a plan step's status: its checkbox and its ` · status` suffix together. Returns the step's line. */
	async setStepStatus(step: string, status: StepStatus, note?: string): Promise<string> {
		if ((status === "blocked" || status === "done") && !note?.trim()) {
			throw new KernelError(
				"VALIDATION",
				status === "done"
					? "Say what was done (and link the commit or PR)."
					: "Say what blocks it.",
			);
		}
		return this.#withStep(step, (lines, at) => {
			if (status === "done") {
				const open = stepTasks(lines, at).filter((index) => /^\s*- \[ \]/.test(lines[index]!));
				if (open.length > 0) {
					const list = open.map((index) => lines[index]!.replace(/^\s*- \[ \] /, "")).join("; ");
					throw new KernelError(
						"VALIDATION",
						`Step ${step} still has open tasks: ${list}. Tick them, or move them to Follow-ups, first.`,
					);
				}
			}
			lines[at] = withStatus(lines[at]!, status, note);
			return lines[at]!;
		});
	}

	/**
	 * Finds one plan step (a top-level item, by number or words from it) and
	 * rewrites its block with `change`, which edits the block's lines in place;
	 * a step's tasks are the indented lines under it in the same block.
	 */
	async #withStep<T>(step: string, change: (lines: string[], at: number) => T): Promise<T> {
		const plan = this.sectionFor("plan-step");
		return this.#withRetry(async () => {
			const page = await this.#read(plan);
			const matches = sectionScope(page.blocks, plan.heading).lines.filter(
				(line) => STEP_LINE.test(line.text) && matchesStep(line.text, step),
			);
			if (matches.length !== 1) {
				throw new KernelError(
					matches.length === 0 ? "NOT_FOUND" : "VALIDATION",
					matches.length === 0
						? `No plan step matches "${step}".`
						: `"${step}" matches ${matches.length} plan steps; use the step number.`,
				);
			}
			const { block, index } = matches[0]!;
			const lines = (block.markdown ?? "").split("\n");
			const result = change(lines, index);
			await this.#edit(plan, page.revision, [
				{ op: "replace_block_markdown", node_id: block.node_id, markdown: lines.join("\n") },
			]);
			return result;
		});
	}

	async recordDecision(decision: string, why: string, rejected?: string): Promise<string> {
		const rejectedText = rejected?.trim() ? ` Rejected: ${sentence(rejected)}` : "";
		const line = `- **${sentence(decision)}** Why: ${sentence(why)}${rejectedText} (${this.today()})`;
		await this.#appendListItem(this.sectionFor("decision"), () => line);
		return line;
	}

	/** Files an item in a section, formatted for the section's item type. Returns what was written. */
	async fileItem(sectionId: string, text: string, detail?: string): Promise<string> {
		const section = this.section(sectionId);
		const extra = detail?.trim();
		switch (section.itemType) {
			case "plan-step":
				throw new KernelError("VALIDATION", "Use add_plan_step for plan steps.");
			case "decision":
				throw new KernelError("VALIDATION", "Use record_decision for decisions.");
			case "task": {
				const line = `- [ ] ${oneLine(text)}${extra ? ` (${oneLine(extra)})` : ""}`;
				await this.#appendListItem(section, () => line);
				return line;
			}
			case "finding": {
				const evidence = extra ? ` Evidence: ${sentence(extra)}` : "";
				const line = `- **${sentence(text)}**${evidence} (${this.today()})`;
				await this.#appendListItem(section, () => line);
				return line;
			}
			case "question": {
				const question = oneLine(text).replace(/[?.]*$/, "?");
				const line = `- **${question}**${extra ? ` ${oneLine(extra)}` : ""}`;
				await this.#appendListItem(section, () => line);
				return line;
			}
			case "artifact": {
				const line = `- ${oneLine(text)}${extra ? ` · ${oneLine(extra)}` : ""} (${this.today()})`;
				await this.#appendListItem(section, () => line);
				return line;
			}
			case "reference": {
				const markdown = `### ${oneLine(text)}\n\n\`\`\`\n${extra ?? ""}\n\`\`\``;
				await this.#appendBlock(section, markdown);
				return markdown;
			}
			case "note": {
				const markdown = extra ? `${text.trim()}\n\n${extra}` : text.trim();
				await this.#appendBlock(section, markdown);
				return markdown;
			}
		}
	}

	/** Replaces the Brief's "Where I left off" with a dated line. */
	async setWhereILeftOff(text: string): Promise<string> {
		const entry = `- ${this.today()}: ${oneLine(text)}`;
		await this.#withRetry(async () => {
			const page = await this.#read({});
			const operations = whereILeftOffEdits(page.blocks, entry);
			await this.#edit({}, page.revision, operations);
		});
		return entry;
	}

	/**
	 * Appends a list item after the section's last one, in the same block
	 * (Pages may keep a section's text and list in one block), so a section
	 * stays one list; a section with no list yet gets one after its last line.
	 */
	async #appendListItem(target: Target, line: (existingLines: string[]) => string): Promise<void> {
		await this.#insert(target, (scope) => {
			const item = line(scope.lines.map((candidate) => candidate.text));
			const lastItem = scope.lines.findLast((candidate) => LIST_LINE.test(candidate.text));
			return { text: item, after: lastItem ?? scope.end, asListItem: lastItem !== undefined };
		});
	}

	/** Adds markdown at the end of the section, as its own paragraph or block. */
	async #appendBlock(target: Target, markdown: string): Promise<void> {
		await this.#insert(target, (scope) => ({
			text: markdown,
			after: target.heading ? scope.end : undefined,
			asListItem: false,
		}));
	}

	/**
	 * Inserts `text` after a line of the section, inside that line's block: a
	 * list item right after it, anything else as a new paragraph. With no line
	 * to follow it goes at the end of the page, under a new heading when the
	 * section's heading is missing.
	 */
	async #insert(
		target: Target,
		place: (scope: ReturnType<typeof sectionScope>) => {
			text: string;
			after: Line | undefined;
			asListItem: boolean;
		},
	): Promise<void> {
		await this.#withRetry(async () => {
			const page = await this.#read(target);
			const scope = sectionScope(page.blocks, target.heading);
			const { text, after, asListItem } = place(scope);
			if (!scope.found) {
				await this.#edit(target, page.revision, [
					{ op: "insert_markdown", markdown: `## ${target.heading}\n\n${text}` },
				]);
				return;
			}
			if (!after) {
				await this.#edit(target, page.revision, [{ op: "insert_markdown", markdown: text }]);
				return;
			}
			const lines = (after.block.markdown ?? "").split("\n");
			const following = lines[after.index + 1];
			const inserted = asListItem ? [text] : ["", text];
			if (
				following !== undefined &&
				following.trim() &&
				!(asListItem && LIST_LINE.test(following))
			) {
				inserted.push("");
			}
			lines.splice(after.index + 1, 0, ...inserted);
			await this.#edit(target, page.revision, [
				{ op: "replace_block_markdown", node_id: after.block.node_id, markdown: lines.join("\n") },
			]);
		});
	}

	#target(target: Target) {
		return target.pageId ? { page_id: target.pageId } : { project_id: this.workbook.projectId };
	}

	async #read(target: Target): Promise<ReadPage> {
		const page = (await this.pages.call("read_page", {
			...this.#target(target),
			comments: "none",
		})) as Partial<ReadPage> | undefined;
		if (!page?.revision) throw new KernelError("UNAVAILABLE", "Pages didn't return the page.");
		return { revision: page.revision, blocks: page.blocks ?? [] };
	}

	async #edit(target: Target, revision: string, operations: unknown[]): Promise<void> {
		await this.pages.call("edit_page", {
			...this.#target(target),
			revision,
			nonce: globalThis.crypto.randomUUID().replaceAll("-", ""),
			operations,
		});
	}

	async #withRetry<T>(write: () => Promise<T>): Promise<T> {
		try {
			return await write();
		} catch (error) {
			if (!String(error).includes("stale_revision")) throw error;
			return write();
		}
	}
}

/** One line of text, without a trailing date (the writer adds its own). */
function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(TRAILING_DATE, "");
}

/** Text ending in one full stop (or its own ? or !). */
function sentence(text: string): string {
	const trimmed = oneLine(text);
	return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stepNumber(line: string): number {
	const match = TASK_LINE.exec(line);
	const number = match ? STEP_NUMBER.exec(match[3]!) : null;
	return number ? Number(number[1]) : 0;
}

/** The indices of a step's tasks: the indented checkbox lines under it, up to the next unindented line. */
function stepTasks(lines: readonly string[], at: number): number[] {
	const tasks: number[] = [];
	for (let index = at + 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (!line.trim()) continue;
		if (!INDENTED.test(line)) break;
		if (TASK_LINE.test(line)) tasks.push(index);
	}
	return tasks;
}

function matchesStep(line: string, step: string): boolean {
	const wanted = step.trim().replace(/\.$/, "");
	if (/^\d+$/.test(wanted)) return stepNumber(line) === Number(wanted);
	return line.toLowerCase().includes(wanted.toLowerCase());
}

/** A task line with its checkbox and ` · status` suffix set for `status`. */
export function withStatus(line: string, status: StepStatus, note?: string): string {
	const [, indent = "", , rest = ""] = TASK_LINE.exec(line) ?? [];
	const body = rest.replace(STATUS_SUFFIX, "");
	const text = note ? oneLine(note) : "";
	switch (status) {
		case "todo":
			return `${indent}- [ ] ${body}`;
		case "in_progress":
			return `${indent}- [ ] ${body} · in progress`;
		case "blocked":
			return `${indent}- [ ] ${body} · blocked: ${text}`;
		case "done":
			return `${indent}- [x] ${body} · done: ${text}`;
	}
}

/**
 * The edits that replace what follows the Brief's "Where I left off" heading
 * (up to the next heading) with `entry`, whether Pages keeps the heading in
 * its own block or in one block with the content; adds the section at the end
 * when the Brief has none.
 */
export function whereILeftOffEdits(blocks: readonly Block[], entry: string): unknown[] {
	const heading = /^## Where I left off\s*$/m;
	const at = blocks.findIndex((block) => heading.test(block.markdown ?? ""));
	if (at === -1) {
		return [{ op: "insert_markdown", markdown: `## Where I left off\n\n${entry}` }];
	}
	const block = blocks[at]!;
	const markdown = block.markdown ?? "";
	const start = markdown.search(heading);
	const afterHeading = markdown.indexOf("\n", start);
	const inBlock = afterHeading === -1 ? "" : markdown.slice(afterHeading);
	if (inBlock.trim()) {
		const next = inBlock.search(/\n#{1,6} /);
		const tail = next === -1 ? "" : inBlock.slice(next);
		const head = markdown.slice(0, afterHeading === -1 ? markdown.length : afterHeading);
		return [
			{
				op: "replace_block_markdown",
				node_id: block.node_id,
				markdown: `${head}\n\n${entry}${tail ? `\n${tail}` : ""}`,
			},
		];
	}
	const following: Block[] = [];
	for (const candidate of blocks.slice(at + 1)) {
		if (/^#{1,6} /.test(candidate.markdown ?? "")) break;
		following.push(candidate);
	}
	if (following.length === 0) {
		return [{ op: "insert_markdown", after_node_id: block.node_id, markdown: entry }];
	}
	const [first, ...rest] = following;
	return [
		{ op: "replace_block_markdown", node_id: first!.node_id, markdown: entry },
		...rest.map((candidate) => ({ op: "delete_block", node_id: candidate.node_id })),
	];
}
