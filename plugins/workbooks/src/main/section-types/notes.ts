import { KernelError } from "@kilo-desktop/kernel";

import type { SectionTypeDefinition } from "../../contracts";

const WHOLE = "Use write_section for a notes section.";

/** Notes: free prose, replaced whole. */
export const notes: SectionTypeDefinition = {
	single: false,
	title: "Notes",
	collects: "Anything worth writing down.",
	usage: "Keep it current: rewrite it as a whole when it changes (write_section).",
	async write(context, section, markdown, options) {
		if (options.part) {
			throw new KernelError("VALIDATION", "A notes section has no parts: write it whole.");
		}
		await context.replaceBody(section, markdown.trim());
		return {};
	},
	refusals: { add: WHOLE, remove: WHOLE, supersede: WHOLE, setStatus: "Notes have no status." },
};
