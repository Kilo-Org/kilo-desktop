import { KernelError } from "@kilo-desktop/kernel";

import { replaceBodyEdits, sectionName } from "./helpers";
import type { Insert } from "./types";

/** The goal: prose in the user's words, rewritten only with their say-so. */
export const goal: Insert = {
	async write(context, section, markdown, options) {
		if (options.part) throw new KernelError("VALIDATION", "The goal has no parts: write it whole.");
		if (!options.userConfirmed) {
			throw new KernelError(
				"VALIDATION",
				`${sectionName(section)} changes only when the user asks: propose the change, and write it once they confirm (userConfirmed).`,
			);
		}
		await context.rewrite(section, (blocks) => ({
			operations: replaceBodyEdits(blocks, section.heading, markdown.trim()),
			result: undefined,
		}));
		return {};
	},
	refusals: {
		add: "The goal is prose: propose a change, then write_section once the user confirms.",
		remove: "The goal is prose: propose a change, then write_section once the user confirms.",
		setStatus: "The goal has no status.",
		supersede: "The goal is prose: propose a change, then write_section once the user confirms.",
	},
};
