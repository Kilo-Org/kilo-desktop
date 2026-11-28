import { KernelError } from "@kilo-desktop/kernel";

import type { WorkbookSectionRef } from "../../contracts";
import { sectionScope } from "../section-scope";
import { ITEM_LINE, appendItem, findItem, oneLine } from "./helpers";
import { log } from "./log";
import type { Insert, InsertContext, NewItem } from "./types";

/**
 * Questions only the user can decide: `- **Question?** context`. An answer is
 * recorded in a log the agent names, then the question goes.
 */

/** An open question: a bold-led bullet ending in "?". */
export const QUESTION_LINE = /^- \*\*.*\?\*\*/;

/** How many open questions `markdown` holds. */
export function openQuestions(markdown: string): number {
	return markdown.split("\n").filter((line) => QUESTION_LINE.test(line.trim())).length;
}

export const questions: Insert = {
	async add(context, section, item) {
		const text = oneLine(item.text).replace(/[?.]*$/, "?");
		const extra = item.detail?.trim();
		const line = `- **${text}**${extra ? ` ${oneLine(extra)}` : ""}`;
		const written = await context.change(section, (scope, edits) => {
			appendItem(scope, edits, line);
			return line;
		});
		return { written };
	},

	async remove(context, section, item) {
		const removed = await context.change(section, (scope, edits) => {
			const line = findItem(scope, item, section);
			edits.remove(line);
			return line.text;
		});
		return { removed };
	},

	refusals: {
		setStatus: "Answer a question with answer_question.",
		supersede: "Answer a question with answer_question.",
		write: "Questions are items: add or answer them instead.",
	},
};

/**
 * Removes an answered question from whichever questions section holds it,
 * first recording the answer in the log `recordIn` when one is given.
 */
export async function answerQuestion(
	context: InsertContext,
	question: string,
	answer: { recordIn?: string; entry?: Omit<NewItem, "supersedes" | "tasks"> },
	read: (section: WorkbookSectionRef) => Promise<{ blocks: Parameters<typeof sectionScope>[0] }>,
): Promise<{ removed: string; recorded?: string }> {
	const candidates = context.workbook.sections.filter((section) => section.type === "questions");
	if (candidates.length === 0)
		throw new KernelError("NOT_FOUND", "This workbook has no questions section.");
	let section = candidates[0]!;
	if (candidates.length > 1) {
		const wanted = question.toLowerCase();
		const pages = await Promise.all(candidates.map((candidate) => read(candidate)));
		const holding = candidates.filter((candidate, index) =>
			sectionScope(pages[index]!.blocks, candidate.heading).lines.some(
				(line) => ITEM_LINE.test(line.text) && line.text.toLowerCase().includes(wanted),
			),
		);
		if (holding.length === 0)
			throw new KernelError("NOT_FOUND", `No open question matches "${question}".`);
		section = holding[0]!;
	}
	const { recordIn } = answer;
	let recorded: string | undefined;
	if (recordIn) {
		if (!answer.entry) throw new KernelError("VALIDATION", "Say what to record (text).");
		const target = context.section(recordIn);
		if (target.type !== "log") {
			throw new KernelError("VALIDATION", "Record an answer in a log section, such as Decisions.");
		}
		recorded = (await log.add!(context, target, answer.entry)).written;
	}
	const { removed } = await questions.remove!(context, section, question);
	return { removed, ...(recorded ? { recorded } : {}) };
}
