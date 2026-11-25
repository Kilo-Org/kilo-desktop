import { KernelError } from "@kilo-desktop/kernel";

import type { TemplateSection, WorkbookSectionRef } from "../../contracts";
import { sectionScope, type Block, type Line } from "../section-scope";
import { INDENTED, appendItem, oneLine } from "./helpers";
import type { Insert, InsertContext, Renumbering, StatusChange, StepStatus } from "./types";

/**
 * The plan: numbered steps, each a top-level checkbox with its tasks
 * indented under it, `- [ ] **N. Title**: intent · status`. Steps are found
 * by number or words from them; re-cutting renumbers them all in order.
 */

const CHECKBOX_LINE = /^(\s*)- \[([ xX])\] (.*)$/;
const STEP_LINE = /^- \[[ xX]\] \*\*\d+\./;
const STATUS_SUFFIX = / · (in progress|blocked:.*|done:.*)$/;
const STEP_PARTS = /^\*\*(\d+)\.\s*(.*?)\*\*:?\s*(.*)$/;
const TASK_INDENT = "  ";

export function stepLine(number: number, title: string, intent: string): string {
	return `- [ ] **${number}. ${oneLine(title)}**: ${oneLine(intent)}`;
}

export function taskLine(text: string, indent = TASK_INDENT): string {
	return `${indent}- [ ] ${oneLine(text)}`;
}

/** The parts of a step line: its number, title, intent (without status) and status. */
export function stepParts(
	line: string,
): { number: number; title: string; intent: string; status: StepStatus } | undefined {
	const checkbox = CHECKBOX_LINE.exec(line);
	if (!checkbox || checkbox[1]) return undefined;
	const parts = STEP_PARTS.exec(checkbox[3]!);
	if (!parts) return undefined;
	const rest = parts[3] ?? "";
	const status: StepStatus = /^[xX]$/.test(checkbox[2]!)
		? "done"
		: / · blocked:/.test(rest)
			? "blocked"
			: / · in progress$/.test(rest)
				? "in_progress"
				: "todo";
	return {
		number: Number(parts[1]),
		title: parts[2]!.trim(),
		intent: rest.replace(STATUS_SUFFIX, ""),
		status,
	};
}

/** A step line with its box and ` · status` suffix set for `status`. */
export function withStatus(line: string, status: StepStatus, note?: string): string {
	const [, indent = "", , rest = ""] = CHECKBOX_LINE.exec(line) ?? [];
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

function withTitleAndIntent(line: string, title?: string, intent?: string): string {
	const checkbox = CHECKBOX_LINE.exec(line)!;
	const parts = STEP_PARTS.exec(checkbox[3]!)!;
	const suffix = STATUS_SUFFIX.exec(parts[3] ?? "")?.[0] ?? "";
	const currentIntent = (parts[3] ?? "").replace(STATUS_SUFFIX, "");
	return `- [${checkbox[2]}] **${parts[1]}. ${title ? oneLine(title) : parts[2]!.trim()}**: ${
		intent ? oneLine(intent) : currentIntent
	}${suffix}`;
}

/** The line indices of a step's tasks: the indented checkbox lines under it. */
function taskIndices(lines: readonly string[], at: number): number[] {
	const tasks: number[] = [];
	for (let index = at + 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (!line.trim()) continue;
		if (!INDENTED.test(line)) break;
		if (CHECKBOX_LINE.test(line)) tasks.push(index);
	}
	return tasks;
}

/** The last line of a step and everything indented under it. */
function stepExtent(lines: readonly string[], at: number): number {
	let end = at;
	for (let index = at + 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (!line.trim()) continue;
		if (!INDENTED.test(line)) break;
		end = index;
	}
	return end;
}

function matchesStep(line: string, step: string): boolean {
	const wanted = step.trim().replace(/\.$/, "");
	if (/^\d+$/.test(wanted)) return stepParts(line)?.number === Number(wanted);
	return line.toLowerCase().includes(wanted.toLowerCase());
}

function stepNotFound(step: string, count: number): KernelError {
	return new KernelError(
		count === 0 ? "NOT_FOUND" : "VALIDATION",
		count === 0
			? `No plan step matches "${step}".`
			: `"${step}" matches ${count} plan steps; use the step number.`,
	);
}

function findStep(lines: readonly string[], step: string): number {
	const matches = lines.flatMap((line, index) =>
		STEP_LINE.test(line) && matchesStep(line, step) ? [index] : [],
	);
	if (matches.length !== 1) throw stepNotFound(step, matches.length);
	return matches[0]!;
}

function stepLines(blocks: readonly Block[], section: WorkbookSectionRef): Line[] {
	return sectionScope(blocks, section.heading).lines.filter((line) => STEP_LINE.test(line.text));
}

const replaceBlock = (block: Block, lines: readonly string[]) => ({
	op: "replace_block_markdown",
	node_id: block.node_id,
	markdown: lines.join("\n"),
});

/** Finds one step and rewrites its block with `change`, which edits the block's lines in place. */
function withStep<T>(
	context: InsertContext,
	section: WorkbookSectionRef,
	step: string,
	change: (lines: string[], at: number) => T,
): Promise<T> {
	return context.rewrite(section, (blocks) => {
		const matches = stepLines(blocks, section).filter((line) => matchesStep(line.text, step));
		if (matches.length !== 1) throw stepNotFound(step, matches.length);
		const { block, index } = matches[0]!;
		const lines = (block.markdown ?? "").split("\n");
		const result = change(lines, index);
		return { operations: [replaceBlock(block, lines)], result };
	});
}

/** Rewrites the block holding every step with `change`, then renumbers the steps in order. */
function withSteps(
	context: InsertContext,
	section: WorkbookSectionRef,
	change: (lines: string[]) => void,
): Promise<Renumbering> {
	return context.rewrite(section, (blocks) => {
		const steps = stepLines(blocks, section);
		const block = steps[0]?.block;
		if (!block) throw new KernelError("NOT_FOUND", "The Plan has no steps.");
		if (steps.some((line) => line.block.node_id !== block.node_id)) {
			throw new KernelError(
				"UNAVAILABLE",
				"The Plan's steps are split across blocks; edit them in Pages.",
			);
		}
		const lines = (block.markdown ?? "").split("\n");
		change(lines);
		const renumbering: Renumbering = [];
		let number = 0;
		for (let index = 0; index < lines.length; index += 1) {
			const parts = stepParts(lines[index]!);
			if (!parts) continue;
			number += 1;
			if (parts.number !== number) renumbering.push({ from: parts.number, to: number });
			lines[index] = lines[index]!.replace(/^(- \[[ xX]\] \*\*)\d+\./, `$1${number}.`);
		}
		return { operations: [replaceBlock(block, lines)], result: renumbering };
	});
}

export const plan: Insert = {
	starter: (section: TemplateSection) =>
		section.starter?.length
			? section.starter
					.flatMap((step, index) => [
						stepLine(index + 1, step.title, step.intent),
						...step.tasks.map((task) => taskLine(task)),
					])
					.join("\n")
			: undefined,

	async add(context, section, item) {
		let number = 0;
		const written = await context.change(section, (scope, edits) => {
			const numbers = scope.lines.flatMap((line) => stepParts(line.text)?.number ?? []);
			number = 1 + Math.max(0, ...numbers);
			const text = [
				stepLine(number, item.text, item.detail ?? ""),
				...(item.tasks ?? []).filter((task) => task.trim()).map((task) => taskLine(task)),
			].join("\n");
			appendItem(scope, edits, text);
			return text;
		});
		return { written, step: number };
	},

	async setStatus(context, section, item, change: StatusChange) {
		const requires = section.requires ?? [];
		if (change.status === "blocked" && !change.reason?.trim()) {
			throw new KernelError("VALIDATION", "Say what blocks it (reason).");
		}
		if (change.status === "done") {
			if (!change.result?.trim())
				throw new KernelError("VALIDATION", "Say what was done (result).");
			if (requires.includes("link-or-reason") && !change.link?.trim() && !change.reason?.trim()) {
				throw new KernelError(
					"VALIDATION",
					"A done step needs a link to what it produced, or the reason there is none.",
				);
			}
		}
		return withStep(context, section, item, (lines, at) => {
			if (change.status === "done" && requires.includes("tasks-ticked")) {
				const open = taskIndices(lines, at).filter((index) => /^\s*- \[ \]/.test(lines[index]!));
				if (open.length > 0) {
					const list = open.map((index) => lines[index]!.replace(/^\s*- \[ \] /, "")).join("; ");
					throw new KernelError(
						"VALIDATION",
						`Step ${item} still has open tasks: ${list}. Tick them, or move them to Follow-ups, first.`,
					);
				}
			}
			const evidence = change.link?.trim() || change.reason?.trim();
			const note =
				change.status === "done"
					? `${oneLine(change.result!)}${evidence ? ` (${oneLine(evidence)})` : ""}`
					: change.reason;
			lines[at] = withStatus(lines[at]!, change.status, note);
			return lines[at]!;
		});
	},

	async remove(context, section, item) {
		let removed = "";
		const renumbered = await withSteps(context, section, (lines) => {
			const at = findStep(lines, item);
			if (stepParts(lines[at]!)!.status === "done") {
				throw new KernelError("VALIDATION", "A done step is part of the record; leave it.");
			}
			removed = lines[at]!;
			lines.splice(at, stepExtent(lines, at) - at + 1);
		});
		return { removed, renumbered };
	},

	refusals: {
		supersede: "Plan steps aren't superseded: edit, move or remove them.",
		write: "The plan holds steps: add or change them instead.",
	},
};

/** Adds a task under a step, after its other tasks. */
export function addTask(
	context: InsertContext,
	section: WorkbookSectionRef,
	step: string,
	text: string,
) {
	return withStep(context, section, step, (lines, at) => {
		const tasks = taskIndices(lines, at);
		const indent = tasks.length > 0 ? INDENTED.exec(lines[tasks.at(-1)!]!)![1]! : undefined;
		const line = taskLine(text, indent);
		lines.splice(stepExtent(lines, at) + 1, 0, line);
		return line;
	});
}

/** Ticks (or unticks) one of a step's tasks, found by words from it. */
export function setTaskDone(
	context: InsertContext,
	section: WorkbookSectionRef,
	step: string,
	task: string,
	done: boolean,
) {
	return withStep(context, section, step, (lines, at) => {
		const wanted = oneLine(task).toLowerCase();
		const matches = taskIndices(lines, at).filter((index) =>
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

/** Renames a step or changes its intent, keeping its number, tasks and status. */
export function editStep(
	context: InsertContext,
	section: WorkbookSectionRef,
	step: string,
	change: { title?: string; intent?: string },
) {
	if (!change.title?.trim() && !change.intent?.trim()) {
		throw new KernelError("VALIDATION", "Give the step a new title or intent.");
	}
	return withStep(context, section, step, (lines, at) => {
		lines[at] = withTitleAndIntent(lines[at]!, change.title?.trim(), change.intent?.trim());
		return lines[at]!;
	});
}

/** Moves a step (with its tasks) before or after another, then renumbers every step. */
export function moveStep(
	context: InsertContext,
	section: WorkbookSectionRef,
	step: string,
	place: { before?: string; after?: string },
): Promise<Renumbering> {
	const anchor = place.before ?? place.after;
	if (!anchor || (place.before && place.after)) {
		throw new KernelError("VALIDATION", "Say which step to put it before, or after.");
	}
	return withSteps(context, section, (lines) => {
		const from = findStep(lines, step);
		if (from === findStep(lines, anchor))
			throw new KernelError("VALIDATION", "A step can't move next to itself.");
		const moved = lines.splice(from, stepExtent(lines, from) - from + 1);
		const target = findStep(lines, anchor);
		lines.splice(place.before ? target : stepExtent(lines, target) + 1, 0, ...moved);
	});
}
