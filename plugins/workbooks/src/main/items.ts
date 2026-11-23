import { KernelError } from "@kilo-desktop/kernel";

import { STEP_STATUSES, type WorkbookSectionRef } from "../contracts";

/**
 * The written formats of workbook items, one per section type, and the
 * patterns that read them back. This is the only place that knows them:
 * the writer composes edits from these lines, and progress reads them.
 */

export type StepStatus = (typeof STEP_STATUSES)[number];
export { STEP_STATUSES };

/** Any checkbox line, a step's or a task's or a checklist item's. */
export const CHECKBOX_LINE = /^(\s*)- \[([ xX])\] (.*)$/;
/** A plan step: a top-level checkbox item whose text starts with its number. */
export const STEP_LINE = /^- \[[ xX]\] \*\*\d+\./;
/** A top-level list item: a checklist item, a journal entry or a question. */
export const ITEM_LINE = /^- /;
export const LIST_LINE = /^\s*- /;
export const INDENTED = /^(\s+)\S/;
/** An open question: a bold-led bullet ending in "?". */
export const QUESTION_LINE = /^- \*\*.*\?\*\*/;
/** A struck-through journal entry. */
export const SUPERSEDED_LINE = /^- ~~/;
/** An italic line (`_…_` or `*…*`, not bold): a section's standing note. */
export const NOTE_LINE = /^(_|\*(?!\*))\S/;

const TASK_INDENT = "  ";
const TRAILING_DATE = /\s*\(\d{4}-\d{2}-\d{2}(?:, [^)]*)?\)[.\s]*$/;
const STATUS_SUFFIX = / · (in progress|blocked:.*|done:.*)$/;
const STEP_PARTS = /^\*\*(\d+)\.\s*(.*?)\*\*:?\s*(.*)$/;

/** One line of text, without a trailing date (the writer adds its own). */
export function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(TRAILING_DATE, "");
}

/** Text ending in one full stop (or its own ? or !). */
export function sentence(text: string): string {
	const trimmed = oneLine(text);
	return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// Steps

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

/** A step line with a new number, keeping everything else. */
export function renumbered(line: string, number: number): string {
	return line.replace(/^(- \[[ xX]\] \*\*)\d+\./, `$1${number}.`);
}

/** A step line with a new title and/or intent, keeping its number, checkbox and status. */
export function withTitleAndIntent(line: string, title?: string, intent?: string): string {
	const checkbox = CHECKBOX_LINE.exec(line)!;
	const parts = STEP_PARTS.exec(checkbox[3]!)!;
	const suffix = STATUS_SUFFIX.exec(parts[3] ?? "")?.[0] ?? "";
	const currentIntent = (parts[3] ?? "").replace(STATUS_SUFFIX, "");
	return `- [${checkbox[2]}] **${parts[1]}. ${title ? oneLine(title) : parts[2]!.trim()}**: ${
		intent ? oneLine(intent) : currentIntent
	}${suffix}`;
}

/** A checkbox line (a step's) with its box and ` · status` suffix set for `status`. */
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

/** The line indices of a step's tasks: the indented checkbox lines under it, up to the next unindented line. */
export function stepTaskIndices(lines: readonly string[], at: number): number[] {
	const tasks: number[] = [];
	for (let index = at + 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (!line.trim()) continue;
		if (!INDENTED.test(line)) break;
		if (CHECKBOX_LINE.test(line)) tasks.push(index);
	}
	return tasks;
}

/** A step and everything indented under it: the lines that move or go with it. */
export function stepExtent(lines: readonly string[], at: number): number {
	let end = at;
	for (let index = at + 1; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (!line.trim()) continue;
		if (!INDENTED.test(line)) break;
		end = index;
	}
	return end;
}

// Checklist items and questions

export function checklistLine(text: string, detail?: string): string {
	const extra = detail?.trim();
	return `- [ ] ${oneLine(text)}${extra ? ` (${oneLine(extra)})` : ""}`;
}

export function questionLine(question: string, context?: string): string {
	const text = oneLine(question).replace(/[?.]*$/, "?");
	const extra = context?.trim();
	return `- **${text}**${extra ? ` ${oneLine(extra)}` : ""}`;
}

// Journal entries

export interface JournalEntry {
	readonly headline: string;
	readonly body?: string;
	readonly fields?: Readonly<Record<string, string>>;
	readonly who?: string;
}

const fieldName = (field: string) => field.replace(/\?$/, "");
const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

/**
 * A journal entry: a bold headline, its body, the section's labelled fields
 * in order, then the date (and who, when given):
 * `- **Use SSE.** Why: simpler. Rejected: websockets. (2026-11-20)`.
 */
export function journalLine(
	section: Pick<WorkbookSectionRef, "fields" | "title" | "id">,
	entry: JournalEntry,
	date: string,
): string {
	const declared = section.fields ?? [];
	const given = Object.fromEntries(
		Object.entries(entry.fields ?? {}).filter(([, value]) => value.trim()),
	);
	const unknown = Object.keys(given).filter(
		(name) => !declared.some((field) => fieldName(field) === name),
	);
	if (unknown.length > 0) {
		throw new KernelError(
			"VALIDATION",
			`${section.title ?? section.id} has no field ${unknown.join(", ")}${
				declared.length
					? ` (its fields: ${declared.map(fieldName).join(", ")})`
					: " (it takes none)"
			}.`,
		);
	}
	const missing = declared.filter((field) => !field.endsWith("?") && !given[field]);
	if (missing.length > 0) {
		throw new KernelError(
			"VALIDATION",
			`An entry in ${section.title ?? section.id} needs ${missing.join(", ")}.`,
		);
	}
	const parts = [`- **${sentence(entry.headline)}**`];
	if (entry.body?.trim()) parts.push(sentence(entry.body));
	for (const field of declared) {
		const value = given[fieldName(field)];
		if (value) parts.push(`${label(fieldName(field))}: ${sentence(value)}`);
	}
	parts.push(`(${date}${entry.who?.trim() ? `, ${oneLine(entry.who)}` : ""})`);
	return parts.join(" ");
}

/** A journal entry struck through, saying what replaced it. */
export function supersededLine(line: string, by: string, date: string): string {
	return `- ~~${line.replace(/^- /, "")}~~ Superseded by: ${sentence(by)} (${date})`;
}

/** The line shown under a section's heading: its note, else what it collects. */
export function sectionNote(
	section: Pick<WorkbookSectionRef, "note" | "collects">,
): string | undefined {
	const text = section.note ?? section.collects;
	return text ? `_${oneLine(text)}_` : undefined;
}
