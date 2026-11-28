import { KernelError } from "@kilo-desktop/kernel";

import type { WorkbookSectionRef } from "../../contracts";
import type { Line, SectionScope } from "../section-scope";
import { replaceBodyEdits, sectionName } from "./helpers";
import type { Insert } from "./types";

/**
 * An output: what the work produces, built up over many chats and kept
 * organised as the finished thing should read. Its parts are subheadings
 * (`### Part` under the section's heading, `## Part` on a page of its own):
 * agents add a part, revise one, or rewrite the whole. Unlike a log it isn't
 * dated or append-only.
 */

const HEADING = /^(#{1,6}) +(.*?)\s*$/;

const partLevel = (section: WorkbookSectionRef) => (section.heading ? 3 : 2);

/** The part titled `title`: its heading line and the lines under it. */
function findPart(scope: SectionScope, section: WorkbookSectionRef, title: string) {
	const level = partLevel(section);
	const wanted = title.trim().toLowerCase();
	const lines = scope.lines;
	const at = lines.findIndex((line) => {
		const match = HEADING.exec(line.text);
		return match?.[1]!.length === level && match[2]!.toLowerCase() === wanted;
	});
	if (at === -1) return undefined;
	const body: Line[] = [];
	for (const line of lines.slice(at + 1)) {
		const match = HEADING.exec(line.text);
		if (match && match[1]!.length <= level) break;
		body.push(line);
	}
	return { heading: lines[at]!, body };
}

export const output: Insert = {
	/** Adds a new part: text = its title, detail = its content. */
	async add(context, section, item) {
		const title = item.text.trim();
		const content = item.detail?.trim();
		if (!content) throw new KernelError("VALIDATION", "Give the part its content (detail).");
		const hashes = "#".repeat(partLevel(section));
		const written = await context.change(section, (scope, edits) => {
			if (findPart(scope, section, title)) {
				throw new KernelError(
					"VALIDATION",
					`${sectionName(section)} already has "${title}": revise it with write_section and part.`,
				);
			}
			const text = `${hashes} ${title}\n\n${content}`;
			edits.insertParagraph(scope.end, text);
			return text;
		});
		return { written };
	},

	/** Rewrites one part (`part`, added when missing) or, without one, the whole section. */
	async write(context, section, markdown, options) {
		const part = options.part?.trim();
		if (part) {
			const hashes = "#".repeat(partLevel(section));
			await context.change(section, (scope, edits) => {
				const found = findPart(scope, section, part);
				if (!found) {
					edits.insertParagraph(scope.end, `${hashes} ${part}\n\n${markdown.trim()}`);
					return;
				}
				for (const line of found.body) if (line.text.trim()) edits.remove(line);
				edits.insertParagraph(found.heading, markdown.trim());
			});
		} else {
			await context.rewrite(section, (blocks) => ({
				operations: replaceBodyEdits(blocks, section.heading, markdown.trim()),
				result: undefined,
			}));
		}
		return {};
	},

	refusals: {
		remove: "Revise or rewrite the output with write_section.",
		setStatus: "An output has no status.",
		supersede: "Revise or rewrite the output with write_section.",
	},
};
