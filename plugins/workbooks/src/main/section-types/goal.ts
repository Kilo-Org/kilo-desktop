import { KernelError } from "@kilo-desktop/kernel";

import { sectionName, type SectionTypeDefinition } from "../../contracts";

const PROSE = "The goal is prose: propose a change, then write_section once the user confirms.";

/** The goal: prose in the user's words, rewritten only with their say-so. */
export const goal: SectionTypeDefinition = {
	single: true,
	title: "Goal",
	collects: "What should be true when this is done, in the user's words.",
	usage:
		"Never rewrite it yourself: propose a change and write it only once the user confirms (write_section with userConfirmed).",
	async write(context, section, markdown, options) {
		if (options.part) throw new KernelError("VALIDATION", "The goal has no parts: write it whole.");
		if (!options.userConfirmed) {
			throw new KernelError(
				"VALIDATION",
				`${sectionName(section)} changes only when the user asks: propose the change, and write it once they confirm (userConfirmed).`,
			);
		}
		await context.replaceBody(section, markdown.trim());
		return {};
	},
	refusals: { add: PROSE, remove: PROSE, supersede: PROSE, setStatus: "The goal has no status." },
};
