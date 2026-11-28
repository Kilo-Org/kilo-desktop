import { z } from "zod";

import {
	NOTE_LINE,
	oneLine,
	sentence,
	type SectionTypeContext,
	type SectionTypeDefinition,
	type WorkbookSectionRef,
} from "../../contracts";
import { addToLog } from "./log";

/**
 * Where we left off: one dated entry, `- **Headline.** Body. (date, who)`,
 * replaced at each handoff; every entry is also added to the workbook's
 * change log, when it has one, so the latest is here and the record is there.
 */

export interface Handoff {
	readonly headline: string;
	readonly body: string;
	readonly who?: string | undefined;
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
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	handoff: Handoff,
): Promise<{ written: string; history?: string }> {
	const written = handoffLine(handoff, context.today());
	const history = context.workbook.sections.find((candidate) => candidate.type === "change-log");
	if (history) await addToLog(context, history, written);
	await context.replaceBody(section, written);
	return { written, ...(history ? { history: history.id } : {}) };
}

const USE = "Use hand_off for Where we left off.";

export const handoff: SectionTypeDefinition = {
	single: true,
	title: "Where we left off",
	collects:
		"The latest handoff only: what was just done, what's next, any (you) tasks, and anything a fresh chat must know.",
	usage:
		"Before stopping, or when the context is running low, hand off (hand_off). It replaces the latest entry; every entry is also kept in the change log, when the workbook has one.",
	starter: () => "- Nothing yet.",
	actions: {
		hand_off: {
			description:
				"Replace the latest handoff (title = a short headline, text = where the work stands, who = who is handing off); it is also kept in the change log.",
			input: z.object({
				title: z.string().min(1),
				text: z.string().min(1),
				who: z.string().optional(),
			}),
			run: (context, section, input: { title: string; text: string; who?: string }) =>
				handOff(context, section, { headline: input.title, body: input.text, who: input.who }),
		},
	},
	refusals: { add: USE, remove: USE, setStatus: USE, supersede: USE, write: USE },
};
