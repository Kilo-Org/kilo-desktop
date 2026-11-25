import { KernelError } from "@kilo-desktop/kernel";

import type { WorkbookSectionRef } from "../../contracts";
import { appendItem, findItem, oneLine, prependItem, sectionName, sentence } from "./helpers";
import type { Insert, InsertContext } from "./types";

/**
 * A log: dated entries, never rewritten. `- **Headline.** Body. Why: ….
 * (2026-11-20, who)`, with the section's declared fields in order. A wrong
 * or reversed entry is struck through and says what replaced it.
 */

export const SUPERSEDED_LINE = /^- ~~/;

export interface LogEntry {
	readonly headline: string;
	readonly body?: string;
	readonly fields?: Readonly<Record<string, string>>;
	readonly who?: string;
}

const fieldName = (field: string) => field.replace(/\?$/, "");
const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

/** An entry in `section`'s format, checking its fields against the section's. */
export function entryLine(
	section: Pick<WorkbookSectionRef, "fields" | "title" | "id">,
	entry: LogEntry,
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
			`${sectionName(section)} has no field ${unknown.join(", ")}${
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
			`An entry in ${sectionName(section)} needs ${missing.join(", ")}.`,
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

function supersededLine(line: string, by: string, date: string): string {
	return `- ~~${line.replace(/^- /, "")}~~ Superseded by: ${sentence(by)} (${date})`;
}

/** Adds an already-written entry to a log, where its `order` puts new ones. */
export function addToLog(
	context: InsertContext,
	section: WorkbookSectionRef,
	line: string,
): Promise<string> {
	return context.change(section, (scope, edits) => {
		if (section.order === "newest-first") prependItem(scope, edits, line);
		else appendItem(scope, edits, line);
		return line;
	});
}

export const log: Insert = {
	async add(context, section, item) {
		const written = await context.change(section, (scope, edits) => {
			const line = entryLine(
				section,
				{
					headline: item.text,
					...(item.detail ? { body: item.detail } : {}),
					...(item.fields ? { fields: item.fields } : {}),
					...(item.who ? { who: item.who } : {}),
				},
				context.today(),
			);
			if (item.supersedes) {
				const old = findItem(
					scope,
					item.supersedes,
					section,
					(text) => !SUPERSEDED_LINE.test(text),
				);
				edits.set(old, supersededLine(old.text, item.text, context.today()));
			}
			if (section.order === "newest-first") prependItem(scope, edits, line);
			else appendItem(scope, edits, line);
			return line;
		});
		return { written };
	},

	supersede: (context, section, item, by) =>
		context.change(section, (scope, edits) => {
			const line = findItem(scope, item, section, (text) => !SUPERSEDED_LINE.test(text));
			const text = supersededLine(line.text, by, context.today());
			edits.set(line, text);
			return text;
		}),

	refusals: {
		remove: "Log entries are never removed: supersede it instead.",
		setStatus: "Log entries have no status: supersede one that's wrong.",
		write: "A log holds entries: add or supersede them instead.",
	},
};
