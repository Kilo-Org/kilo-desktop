import type { WorkbookSectionRef } from "../../contracts";
import { findItem, oneLine, prependItem, sentence } from "./helpers";
import type { Insert, InsertContext } from "./types";

/**
 * A log: dated entries, newest first, never rewritten:
 * `- **Headline.** Body. (2026-11-20, who)`. A wrong or reversed entry is
 * struck through and says what replaced it.
 */

export const SUPERSEDED_LINE = /^- ~~/;

export interface LogEntry {
	readonly headline: string;
	readonly body?: string;
	readonly who?: string;
}

/** An entry in a log's format. */
export function entryLine(entry: LogEntry, date: string): string {
	const parts = [`- **${sentence(entry.headline)}**`];
	if (entry.body?.trim()) parts.push(sentence(entry.body));
	parts.push(`(${date}${entry.who?.trim() ? `, ${oneLine(entry.who)}` : ""})`);
	return parts.join(" ");
}

function supersededLine(line: string, by: string, date: string): string {
	return `- ~~${line.replace(/^- /, "")}~~ Superseded by: ${sentence(by)} (${date})`;
}

/** Adds an already-written entry at the top of a log. */
export function addToLog(
	context: InsertContext,
	section: WorkbookSectionRef,
	line: string,
): Promise<string> {
	return context.change(section, (scope, edits) => {
		prependItem(scope, edits, line);
		return line;
	});
}

export function supersedeEntry(
	context: InsertContext,
	section: WorkbookSectionRef,
	item: string,
	by: string,
): Promise<string> {
	return context.change(section, (scope, edits) => {
		const line = findItem(scope, item, section, (text) => !SUPERSEDED_LINE.test(text));
		const text = supersededLine(line.text, by, context.today());
		edits.set(line, text);
		return text;
	});
}

export const log: Insert = {
	async add(context, section, item) {
		const written = await context.change(section, (scope, edits) => {
			const line = entryLine(
				{
					headline: item.text,
					...(item.detail ? { body: item.detail } : {}),
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
			prependItem(scope, edits, line);
			return line;
		});
		return { written };
	},

	supersede: supersedeEntry,

	refusals: {
		remove: "Log entries are never removed: supersede it instead.",
		setStatus: "Log entries have no status: supersede one that's wrong.",
		write: "A log holds entries: add or supersede them instead.",
	},
};
