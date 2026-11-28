import {
	INDENTED,
	ITEM_LINE,
	LIST_LINE,
	NOTE_LINE,
	type SectionEdits,
	type SectionLine,
} from "../contracts";
import { sectionScope, type Block, type Line, type SectionScope } from "./section-scope";

/**
 * The edits that replace a section's body with `body`, keeping the italic
 * note that leads it (its first line, when italic): under its heading (added at the end of the page when
 * missing), or the whole page for a section without one.
 */
export function replaceBodyEdits(
	blocks: readonly Block[],
	heading: string | undefined,
	body: string,
): unknown[] {
	const scope = sectionScope(blocks, heading);
	if (!scope.found) return [{ op: "insert_markdown", markdown: `## ${heading}\n\n${body}` }];
	const edits = new LineEdits();
	let anchor = scope.heading;
	const first = scope.lines.find((line) => line.text.trim());
	for (const line of scope.lines) {
		if (!line.text.trim()) continue;
		if (line === first && NOTE_LINE.test(line.text.trim())) {
			anchor = line;
			continue;
		}
		edits.remove(line);
	}
	if (!anchor) {
		for (const block of new Set(scope.lines.map((line) => line.block))) edits.removeBlock(block);
		return [...edits.operations(), { op: "insert_markdown", after_node_id: null, markdown: body }];
	}
	edits.insertParagraph(anchor, body);
	return edits.operations();
}

/**
 * Line edits across a page's blocks, turned into one replace (or delete) per
 * changed block. Pages may keep a section's heading, text and list in one
 * block or split them across several, so sections are edited by line.
 */
export class LineEdits {
	readonly #blocks = new Map<
		string,
		{
			block: Block;
			set: Map<number, string | null>;
			before: Map<number, string[]>;
			after: Map<number, string[]>;
		}
	>();
	readonly #removedBlocks = new Set<string>();
	#pending: string[] = [];

	set(line: Line, text: string) {
		this.#entry(line.block).set.set(line.index, text);
	}

	remove(line: Line) {
		this.#entry(line.block).set.set(line.index, null);
	}

	removeBlock(block: Block) {
		this.#removedBlocks.add(block.node_id);
	}

	insertBefore(line: Line, texts: readonly string[]) {
		const entry = this.#entry(line.block);
		entry.before.set(line.index, [...(entry.before.get(line.index) ?? []), ...texts]);
	}

	insertAfter(line: Line, texts: readonly string[]) {
		const entry = this.#entry(line.block);
		entry.after.set(line.index, [...(entry.after.get(line.index) ?? []), ...texts]);
	}

	/** `text` as its own paragraph after `line`; with no line (an empty section), kept for a new block. */
	insertParagraph(line: Line | undefined, text: string) {
		if (!line) {
			this.#pending.push(text);
			return;
		}
		this.insertAfter(line, ["", text, ""]);
	}

	/** Text with nowhere to go yet: the caller puts it in a new block. */
	pendingText(): string {
		return this.#pending.join("\n\n");
	}

	operations(): unknown[] {
		const operations: unknown[] = [];
		for (const { block, set, before, after } of this.#blocks.values()) {
			if (this.#removedBlocks.has(block.node_id)) continue;
			const out: string[] = [];
			(block.markdown ?? "").split("\n").forEach((line, index) => {
				out.push(...(before.get(index) ?? []));
				const value = set.has(index) ? set.get(index) : line;
				if (value !== null && value !== undefined) out.push(...value.split("\n"));
				out.push(...(after.get(index) ?? []));
			});
			const markdown = tidy(out);
			operations.push(
				markdown
					? { op: "replace_block_markdown", node_id: block.node_id, markdown }
					: { op: "delete_block", node_id: block.node_id },
			);
		}
		for (const id of this.#removedBlocks) operations.push({ op: "delete_block", node_id: id });
		if (this.#pending.length > 0)
			operations.push({ op: "insert_markdown", markdown: this.pendingText() });
		return operations;
	}

	#entry(block: Block) {
		let entry = this.#blocks.get(block.node_id);
		if (!entry) {
			entry = { block, set: new Map(), before: new Map(), after: new Map() };
			this.#blocks.set(block.node_id, entry);
		}
		return entry;
	}
}

/** Lines joined, without leading, trailing or repeated blank lines, and with a blank line between a list and what follows it. */
function tidy(lines: readonly string[]): string {
	const out: string[] = [];
	for (const line of lines) {
		const blank = !line.trim();
		if (blank && (out.length === 0 || !out.at(-1)!.trim())) continue;
		const previous = out.at(-1);
		if (
			!blank &&
			previous !== undefined &&
			previous.trim() &&
			LIST_LINE.test(previous) &&
			!LIST_LINE.test(line) &&
			!INDENTED.test(line)
		) {
			out.push("");
		}
		out.push(blank ? "" : line);
	}
	while (out.length > 0 && !out.at(-1)!.trim()) out.pop();
	return out.join("\n");
}

/**
 * The `SectionEdits` a section type is given: line edits within one
 * section's scope, with its list and paragraph helpers.
 */
export function sectionEdits(scope: SectionScope, edits: LineEdits): SectionEdits {
	const line = (value: SectionLine) => value as Line;
	const append = (text: string) => {
		const last = scope.lines.findLast((candidate) => LIST_LINE.test(candidate.text));
		if (last) edits.insertAfter(last, [text]);
		else edits.insertParagraph(scope.end, text);
	};
	return {
		set: (value, text) => edits.set(line(value), text),
		remove: (value) => edits.remove(line(value)),
		insertBefore: (value, texts) => edits.insertBefore(line(value), texts),
		insertAfter: (value, texts) => edits.insertAfter(line(value), texts),
		append,
		prepend: (text) => {
			const first = scope.lines.find((candidate) => ITEM_LINE.test(candidate.text));
			if (first) edits.insertBefore(first, [text]);
			else append(text);
		},
		appendParagraph: (text) => edits.insertParagraph(scope.end, text),
		insertParagraphAfter: (value, text) => edits.insertParagraph(line(value), text),
	};
}
