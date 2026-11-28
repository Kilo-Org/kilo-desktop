import { z } from "zod";

import { KernelError } from "@kilo-desktop/kernel";

import {
	INDENTED,
	oneLine,
	type SectionLine,
	type SectionEdits,
	type SectionTypeContext,
	type SectionTypeDefinition,
	type StatusChange,
	type StepStatus,
	type WorkbookSectionRef,
} from "../../contracts";

/** Steps whose numbers changed: `from` is the old number, `to` the new. */
export type Renumbering = { from: number; to: number }[];

/**
 * The plan: numbered steps, each a top-level checkbox with its tasks
 * indented under it, `- [ ] **N. Title**: intent · status`. Steps are found
 * by number or words from them; re-cutting renumbers them all in order. A
 * step is done only once its tasks are ticked, with what it achieved and,
 * optionally, a link to it.
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

/** Replaces `lines` with `texts` (which may be more or fewer lines). */
function replaceLines(
	lines: readonly SectionLine[],
	texts: readonly string[],
	edits: SectionEdits,
) {
	edits.set(lines[0]!, texts.join("\n"));
	for (const line of lines.slice(1)) edits.remove(line);
}

/** Finds one step and lets `change` edit its lines (the step, then its tasks) in place. */
function withStep<T>(
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	step: string,
	change: (lines: string[], at: number) => T,
): Promise<T> {
	return context.edit(section, (all, edits) => {
		const texts = all.map((line) => line.text);
		const matches = texts.flatMap((text, index) =>
			STEP_LINE.test(text) && matchesStep(text, step) ? [index] : [],
		);
		if (matches.length !== 1) throw stepNotFound(step, matches.length);
		const at = matches[0]!;
		const end = stepExtent(texts, at);
		const region = texts.slice(at, end + 1);
		const result = change(region, 0);
		replaceLines(all.slice(at, end + 1), region, edits);
		return result;
	});
}

/** Lets `change` edit every step's lines (first step through the last's tasks), then renumbers them in order. */
function withSteps(
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	change: (lines: string[]) => void,
): Promise<Renumbering> {
	return context.edit(section, (all, edits) => {
		const texts = all.map((line) => line.text);
		const steps = texts.flatMap((text, index) => (STEP_LINE.test(text) ? [index] : []));
		if (steps.length === 0) throw new KernelError("NOT_FOUND", "The Plan has no steps.");
		const first = steps[0]!;
		const last = stepExtent(texts, steps.at(-1)!);
		const region = texts.slice(first, last + 1);
		change(region);
		const renumbering: Renumbering = [];
		let number = 0;
		for (let index = 0; index < region.length; index += 1) {
			const parts = stepParts(region[index]!);
			if (!parts) continue;
			number += 1;
			if (parts.number !== number) renumbering.push({ from: parts.number, to: number });
			region[index] = region[index]!.replace(/^(- \[[ xX]\] \*\*)\d+\./, `$1${number}.`);
		}
		replaceLines(all.slice(first, last + 1), region, edits);
		return renumbering;
	});
}

export const plan: SectionTypeDefinition = {
	single: true,
	title: "Plan",
	collects:
		"The work, in order, each step sized for one chat; the checkboxes under it are its tasks, and jobs only the user can do are marked (you).",
	usage:
		"Mark a step in progress before starting it, tick its tasks as you go, and mark it done once they're all ticked, saying what it achieved (set_status). Re-cut the plan with edit_step, move_step, add_item and remove_item; steps renumber themselves.",
	starter: () =>
		[
			stepLine(1, "Refine the Brief and draft this Plan", "the first chat's job."),
			taskLine("Fill in what the Brief is missing, asking the user"),
			taskLine("Draft the steps, each with its tasks"),
			taskLine("Confirm the Plan (you)"),
		].join("\n"),

	async add(context, section, item) {
		let number = 0;
		const written = await context.edit(section, (lines, edits) => {
			const numbers = lines.flatMap((line) => stepParts(line.text)?.number ?? []);
			number = 1 + Math.max(0, ...numbers);
			const text = [
				stepLine(number, item.text, item.detail ?? ""),
				...(item.tasks ?? []).filter((task) => task.trim()).map((task) => taskLine(task)),
			].join("\n");
			edits.append(text);
			return text;
		});
		return { written, step: number };
	},

	async setStatus(context, section, item, change: StatusChange) {
		if (change.status === "blocked" && !change.reason?.trim()) {
			throw new KernelError("VALIDATION", "Say what blocks it (reason).");
		}
		if (change.status === "done" && !change.result?.trim()) {
			throw new KernelError("VALIDATION", "Say what it achieved (result).");
		}
		return withStep(context, section, item, (lines, at) => {
			if (change.status === "done") {
				const open = taskIndices(lines, at).filter((index) => /^\s*- \[ \]/.test(lines[index]!));
				if (open.length > 0) {
					const list = open.map((index) => lines[index]!.replace(/^\s*- \[ \] /, "")).join("; ");
					throw new KernelError(
						"VALIDATION",
						`Step ${item} still has open tasks: ${list}. Tick them, or remove or move them, first.`,
					);
				}
			}
			const note =
				change.status === "done"
					? `${oneLine(change.result!)}${change.link?.trim() ? ` (${oneLine(change.link)})` : ""}`
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

	actions: {
		add_task: {
			description: "Add a task under a step (step = its number or words from it; text).",
			input: z.object({ step: z.string().min(1), text: z.string().min(1) }),
			run: (context, section, input: { step: string; text: string }) =>
				addTask(context, section, input.step, input.text),
		},
		set_task_done: {
			description: "Tick (or, with done: false, untick) a step's task (task = words from it).",
			input: z.object({
				step: z.string().min(1),
				task: z.string().min(1),
				done: z.boolean().default(true),
			}),
			run: (context, section, input: { step: string; task: string; done: boolean }) =>
				setTaskDone(context, section, input.step, input.task, input.done),
		},
		edit_step: {
			description: "Rename a step or change its intent, keeping its number, tasks and status.",
			input: z.object({
				step: z.string().min(1),
				title: z.string().optional(),
				intent: z.string().optional(),
			}),
			run: (context, section, input: { step: string; title?: string; intent?: string }) =>
				editStep(context, section, input.step, input),
		},
		move_step: {
			description:
				"Move a step (with its tasks) before or after another; returns the numbers that changed.",
			input: z.object({
				step: z.string().min(1),
				before: z.string().optional(),
				after: z.string().optional(),
			}),
			run: (context, section, input: { step: string; before?: string; after?: string }) =>
				moveStep(context, section, input.step, input),
		},
	},

	refusals: {
		supersede: "Plan steps aren't superseded: edit, move or remove them.",
		write: "The plan holds steps: add or change them instead.",
	},
};

/** Adds a task under a step, after its other tasks. */
export function addTask(
	context: SectionTypeContext,
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
	context: SectionTypeContext,
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
	context: SectionTypeContext,
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
	context: SectionTypeContext,
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
