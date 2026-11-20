/** A Pages block, as `read_page` returns it. */
export interface Block {
	readonly node_id: string;
	readonly markdown?: string;
}

/** One line of a block's markdown. */
export interface Line {
	readonly block: Block;
	readonly index: number;
	readonly text: string;
}

export interface SectionScope {
	/** False when the page has no heading for the section. */
	readonly found: boolean;
	/** The section's lines: under its heading up to the next heading of its level or above, or the whole page. */
	readonly lines: readonly Line[];
	/** What new content follows: the section's last non-blank line, else its heading; none on an empty page. */
	readonly end?: Line;
}

const HEADING = /^(#{1,6}) +(.*?)\s*$/;

/**
 * Where a section is on its page. Pages may keep a heading, its text and its
 * list in one block or split them across several, so a section is found by
 * line across blocks, never by block. Without a heading the section is the
 * whole page.
 */
export function sectionScope(blocks: readonly Block[], heading?: string): SectionScope {
	const all = blocks.flatMap((block) =>
		(block.markdown ?? "").split("\n").map((text, index) => ({ block, index, text })),
	);
	const lastFilled = (lines: readonly Line[]) => lines.findLast((line) => line.text.trim());
	if (!heading) {
		const end = lastFilled(all);
		return { found: true, lines: all, ...(end ? { end } : {}) };
	}
	const wanted = heading.trim().toLowerCase();
	const at = all.findIndex((line) => HEADING.exec(line.text)?.[2]?.toLowerCase() === wanted);
	if (at === -1) return { found: false, lines: [] };
	const level = HEADING.exec(all[at]!.text)![1]!.length;
	const after = all.slice(at + 1);
	const next = after.findIndex((line) => {
		const match = HEADING.exec(line.text);
		return match !== null && match[1]!.length <= level;
	});
	const lines = next === -1 ? after : after.slice(0, next);
	return { found: true, lines, end: lastFilled(lines) ?? all[at]! };
}

/** A section's markdown out of its page's markdown (the whole page without a heading). */
export function sectionMarkdown(markdown: string, heading?: string): string {
	return sectionScope([{ node_id: "", markdown }], heading)
		.lines.map((line) => line.text)
		.join("\n")
		.trim();
}
