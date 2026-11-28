import { z } from "zod";

import { KernelError } from "@kilo-desktop/kernel";

import {
	findItem,
	oneLine,
	type SectionTypeContext,
	type SectionTypeDefinition,
	type WorkbookSectionRef,
} from "../../contracts";
import { log } from "./log";

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

export interface Answer {
	readonly question: string;
	/** The log the answer is recorded in. */
	readonly recordIn?: string | undefined;
	/** The answer as an entry headline, and the rest. */
	readonly text?: string | undefined;
	readonly detail?: string | undefined;
}

/** Records the answer in `recordIn` when given, then removes the question. */
async function answer(
	context: SectionTypeContext,
	section: WorkbookSectionRef,
	input: Answer,
): Promise<{ removed: string; recorded?: string }> {
	let recorded: string | undefined;
	if (input.recordIn) {
		if (!input.text?.trim()) throw new KernelError("VALIDATION", "Say what to record (text).");
		const target = context.section(input.recordIn);
		if (target.type !== "log") {
			throw new KernelError("VALIDATION", "Record an answer in a log section, such as Decisions.");
		}
		recorded = (
			await log.add!(context, target, {
				text: input.text,
				...(input.detail ? { detail: input.detail } : {}),
			})
		).written;
	}
	const { removed } = await questions.remove!(context, section, input.question);
	return { removed, ...(recorded ? { recorded } : {}) };
}

export const questions: SectionTypeDefinition = {
	single: false,
	title: "Open questions",
	collects: "Things only the user can decide.",
	usage:
		"Put questions only the user can answer here, not only in the chat (add_item). When the user answers one, record the answer in a log and remove the question (answer_question with recordIn).",

	async add(context, section, item) {
		const text = oneLine(item.text).replace(/[?.]*$/, "?");
		const extra = item.detail?.trim();
		const line = `- **${text}**${extra ? ` ${oneLine(extra)}` : ""}`;
		await context.edit(section, (_lines, edits) => edits.append(line));
		return { written: line };
	},

	async remove(context, section, item) {
		const removed = await context.edit(section, (lines, edits) => {
			const line = findItem(lines, item, section);
			edits.remove(line);
			return line.text;
		});
		return { removed };
	},

	actions: {
		answer: {
			description:
				"Record the user's answer to a question (question = words from it) in a log (recordIn, text, detail), and remove the question.",
			input: z.object({
				question: z.string().min(1),
				recordIn: z.string().optional(),
				text: z.string().optional(),
				detail: z.string().optional(),
			}),
			run: (context, section, input: Answer) => answer(context, section, input),
		},
	},

	refusals: {
		setStatus: "Answer a question with answer_question.",
		supersede: "Answer a question with answer_question.",
		write: "Questions are items: add or answer them instead.",
	},
};
