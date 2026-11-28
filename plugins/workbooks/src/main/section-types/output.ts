import { KernelError } from "@kilo-desktop/kernel";

import {
	sectionName,
	type SectionLine,
	type SectionTypeDefinition,
	type WorkbookSectionRef,
} from "../../contracts";

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
function findPart(lines: readonly SectionLine[], section: WorkbookSectionRef, title: string) {
	const level = partLevel(section);
	const wanted = title.trim().toLowerCase();
	const at = lines.findIndex((line) => {
		const match = HEADING.exec(line.text);
		return match?.[1]!.length === level && match[2]!.toLowerCase() === wanted;
	});
	if (at === -1) return undefined;
	const body: SectionLine[] = [];
	for (const line of lines.slice(at + 1)) {
		const match = HEADING.exec(line.text);
		if (match && match[1]!.length <= level) break;
		body.push(line);
	}
	return { heading: lines[at]!, body };
}

export const output: SectionTypeDefinition = {
	single: false,
	title: "Result",
	collects: "What the work produces, organised as the finished thing should read.",
	usage:
		"Build the result here as the chat produces it, organised as the finished thing should read: add a new part (add_item: text = its title, detail = its content), improve the part something belongs to (write_section with part), or rewrite the whole when it needs reshaping (write_section). Never notes or drafts about the chat.",
	/** Adds a new part: text = its title, detail = its content. */
	async add(context, section, item) {
		const title = item.text.trim();
		const content = item.detail?.trim();
		if (!content) throw new KernelError("VALIDATION", "Give the part its content (detail).");
		const hashes = "#".repeat(partLevel(section));
		const written = await context.edit(section, (lines, edits) => {
			if (findPart(lines, section, title)) {
				throw new KernelError(
					"VALIDATION",
					`${sectionName(section)} already has "${title}": revise it with write_section and part.`,
				);
			}
			const text = `${hashes} ${title}\n\n${content}`;
			edits.appendParagraph(text);
			return text;
		});
		return { written };
	},

	/** Rewrites one part (`part`, added when missing) or, without one, the whole section. */
	async write(context, section, markdown, options) {
		const part = options.part?.trim();
		if (part) {
			const hashes = "#".repeat(partLevel(section));
			await context.edit(section, (lines, edits) => {
				const found = findPart(lines, section, part);
				if (!found) {
					edits.appendParagraph(`${hashes} ${part}\n\n${markdown.trim()}`);
					return;
				}
				for (const line of found.body) if (line.text.trim()) edits.remove(line);
				edits.insertParagraphAfter(found.heading, markdown.trim());
			});
		} else {
			await context.replaceBody(section, markdown.trim());
		}
		return {};
	},

	refusals: {
		remove: "Revise or rewrite the output with write_section.",
		setStatus: "An output has no status.",
		supersede: "Revise or rewrite the output with write_section.",
	},
};
