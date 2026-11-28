import {
	findItem,
	oneLine,
	sentence,
	type SectionTypeContext,
	type SectionTypeDefinition,
	type WorkbookSectionRef,
} from "../../contracts";

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
export async function addToLog(
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	line: string,
): Promise<string> {
	await context.edit(section, (_lines, edits) => edits.prepend(line));
	return line;
}

export function supersedeEntry(
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	item: string,
	by: string,
): Promise<string> {
	return context.edit(section, (lines, edits) => {
		const line = findItem(lines, item, section, (text) => !SUPERSEDED_LINE.test(text));
		const text = supersededLine(line.text, by, context.today());
		edits.set(line, text);
		return text;
	});
}

export const log: SectionTypeDefinition = {
	single: false,
	title: "Log",
	collects: "Things worth keeping, as they come up.",
	usage:
		"Add an entry the moment something worth keeping comes up (add_item: text = a headline, detail = the rest). Never edit or delete an entry: supersede a wrong one (supersede), and record a reversal as a new entry that supersedes the old (add_item with supersedes).",

	async add(context, section, item) {
		const line = entryLine(
			{
				headline: item.text,
				...(item.detail ? { body: item.detail } : {}),
				...(item.who ? { who: item.who } : {}),
			},
			context.today(),
		);
		await context.edit(section, (lines, edits) => {
			if (item.supersedes) {
				const old = findItem(
					lines,
					item.supersedes,
					section,
					(text) => !SUPERSEDED_LINE.test(text),
				);
				edits.set(old, supersededLine(old.text, item.text, context.today()));
			}
			edits.prepend(line);
		});
		return { written: line };
	},

	supersede: supersedeEntry,

	refusals: {
		remove: "Log entries are never removed: supersede it instead.",
		setStatus: "Log entries have no status: supersede one that's wrong.",
		write: "A log holds entries: add or supersede them instead.",
	},
};
