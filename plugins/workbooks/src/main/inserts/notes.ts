import { KernelError } from "@kilo-desktop/kernel";

import { replaceBodyEdits, sectionName } from "./helpers";
import type { Insert } from "./types";

/** Notes: free prose, replaced whole; `protected` notes change only with the user's say-so. */
export const notes: Insert = {
	async write(context, section, markdown, options) {
		if (options.part)
			throw new KernelError("VALIDATION", "A notes section has no parts: write it whole.");
		if (section.protected && !options.userConfirmed) {
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
		add: "Use write_section for a notes section.",
		remove: "Use write_section for a notes section.",
		setStatus: "Notes have no status.",
		supersede: "Use write_section for a notes section.",
	},
};
