import type { WorkbookSectionRef } from "../../contracts";
import { NOTE_LINE, oneLine, replaceBodyEdits, sentence } from "./helpers";
import { addToLog } from "./log";
import type { Insert, InsertContext } from "./types";

/**
 * Where we left off: one dated entry, `- **Headline.** Body. (date, who)`,
 * replaced at each handoff; every entry is also added to the workbook's
 * change log, when it has one, so the latest is here and the record is there.
 */

export interface Handoff {
	readonly headline: string;
	readonly body: string;
	readonly who?: string;
}

function handoffLine(handoff: Handoff, date: string): string {
	return `- **${sentence(handoff.headline)}** ${sentence(handoff.body)} (${date}${
		handoff.who?.trim() ? `, ${oneLine(handoff.who)}` : ""
	})`;
}

/** The handoff's entries, read from its markdown (without its note or the placeholder). */
export function handoffEntries(markdown: string): string[] {
	return markdown
		.split("\n")
		.filter((line) => /^\s*- /.test(line) && !NOTE_LINE.test(line.trim()))
		.map((line) => line.replace(/^\s*- /, "").trim())
		.filter((line) => line && line !== "Nothing yet.");
}

/** Replaces the entry (keeping its note) and adds the same entry to the change log. */
export async function handOff(
	context: InsertContext,
	section: WorkbookSectionRef,
	handoff: Handoff,
): Promise<{ written: string; history?: string }> {
	const written = handoffLine(handoff, context.today());
	const history = context.workbook.sections.find((candidate) => candidate.type === "change-log");
	if (history) await addToLog(context, history, written);
	await context.rewrite(section, (blocks) => ({
		operations: replaceBodyEdits(blocks, section.heading, written),
		result: undefined,
	}));
	return { written, ...(history ? { history: history.id } : {}) };
}

export const handoff: Insert = {
	starter: () => "- Nothing yet.",
	refusals: {
		add: "Use hand_off for Where we left off.",
		remove: "Use hand_off for Where we left off.",
		setStatus: "Use hand_off for Where we left off.",
		supersede: "Use hand_off for Where we left off.",
		write: "Use hand_off for Where we left off.",
	},
};
