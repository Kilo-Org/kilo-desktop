import { KernelError } from "@kilo-desktop/kernel";

import { replaceBodyEdits } from "./helpers";
import type { Insert } from "./types";

/** Notes: free prose, replaced whole. */
export const notes: Insert = {
	async write(context, section, markdown, options) {
		if (options.part)
			throw new KernelError("VALIDATION", "A notes section has no parts: write it whole.");
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
