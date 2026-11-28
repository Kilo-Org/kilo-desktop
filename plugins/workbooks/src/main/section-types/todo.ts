import { KernelError } from "@kilo-desktop/kernel";

import { findItem, oneLine, type SectionTypeDefinition } from "../../contracts";

/** A todo list: independent tick boxes, `- [ ] Item (context)`. */

const CHECKBOX = /^- \[[ xX]\]/;

export const todo: SectionTypeDefinition = {
	single: false,
	title: "To do",
	collects: "Things to do, ticked when done.",
	usage: "Add items as they come up (add_item) and tick them when done (set_status).",

	async add(context, section, item) {
		const extra = item.detail?.trim();
		const line = `- [ ] ${oneLine(item.text)}${extra ? ` (${oneLine(extra)})` : ""}`;
		await context.edit(section, (_lines, edits) => edits.append(line));
		return { written: line };
	},

	setStatus(context, section, item, change) {
		if (change.status !== "done" && change.status !== "todo") {
			throw new KernelError("VALIDATION", "A todo item is either done or todo.");
		}
		return context.edit(section, (lines, edits) => {
			const line = findItem(lines, item, section, (text) => CHECKBOX.test(text));
			const text = line.text.replace(CHECKBOX, `- [${change.status === "done" ? "x" : " "}]`);
			edits.set(line, text);
			return text;
		});
	},

	async remove(context, section, item) {
		const removed = await context.edit(section, (lines, edits) => {
			const line = findItem(lines, item, section);
			edits.remove(line);
			return line.text;
		});
		return { removed };
	},

	refusals: {
		supersede: "Todo items aren't superseded: tick or remove them.",
		write: "A todo list holds items: add, tick or remove them instead.",
	},
};
