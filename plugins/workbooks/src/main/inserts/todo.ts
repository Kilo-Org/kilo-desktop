import { KernelError } from "@kilo-desktop/kernel";

import { appendItem, findItem, oneLine } from "./helpers";
import type { Insert } from "./types";

/** A todo list: independent tick boxes, `- [ ] Item (context)`. */

const CHECKBOX = /^- \[[ xX]\]/;

export const todo: Insert = {
	async add(context, section, item) {
		const extra = item.detail?.trim();
		const line = `- [ ] ${oneLine(item.text)}${extra ? ` (${oneLine(extra)})` : ""}`;
		const written = await context.change(section, (scope, edits) => {
			appendItem(scope, edits, line);
			return line;
		});
		return { written };
	},

	setStatus(context, section, item, change) {
		if (change.status !== "done" && change.status !== "todo") {
			throw new KernelError("VALIDATION", "A todo item is either done or todo.");
		}
		return context.change(section, (scope, edits) => {
			const line = findItem(scope, item, section, (text) => CHECKBOX.test(text));
			const text = line.text.replace(CHECKBOX, `- [${change.status === "done" ? "x" : " "}]`);
			edits.set(line, text);
			return text;
		});
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
		supersede: "Todo items aren't superseded: tick or remove them.",
		write: "A todo list holds items: add, tick or remove them instead.",
	},
};
