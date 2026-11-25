import { KernelError } from "@kilo-desktop/kernel";

import type { WorkbookSectionRef } from "../../contracts";
import { sectionScope, type Block, type Line, type SectionScope } from "../section-scope";

/**
 * Plain functions inserts share: text tidying, finding an item, and composing
 * line edits. Sharing a helper never ties two inserts together: an insert
 * that needs to differ stops calling it.
 */

/** A top-level list item. */
export const ITEM_LINE = /^- /;
export const LIST_LINE = /^\s*- /;
export const INDENTED = /^(\s+)\S/;
/** An italic line (`_…_` or `*…*`, not bold): a section's standing note. */
export const NOTE_LINE = /^(_|\*(?!\*))\S/;

const TRAILING_DATE = /\s*\(\d{4}-\d{2}-\d{2}(?:, [^)]*)?\)[.\s]*$/;

/** One line of text, without a trailing date (the writer adds its own). */
export function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(TRAILING_DATE, "");
}

/** Text ending in one full stop (or its own ? or !). */
export function sentence(text: string): string {
	const trimmed = oneLine(text);
	return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export const sectionName = (section: Pick<WorkbookSectionRef, "title" | "id">) =>
	section.title ?? section.id;

/** The line shown under a section's heading: its note, else what it collects. */
export function sectionNote(
	section: Pick<WorkbookSectionRef, "note" | "collects">,
): string | undefined {
	const text = section.note ?? section.collects;
	return text ? `_${oneLine(text)}_` : undefined;
}

/** The one top-level item of the section matching `words` (and `accept`, when given). */
export function findItem(
	scope: SectionScope,
	words: string,
	section: WorkbookSectionRef,
	accept: (text: string) => boolean = () => true,
): Line {
	const wanted = oneLine(words).toLowerCase();
	const matches = scope.lines.filter(
		(line) =>
			ITEM_LINE.test(line.text) && accept(line.text) && line.text.toLowerCase().includes(wanted),
	);
	if (matches.length !== 1) {
		throw new KernelError(
			matches.length === 0 ? "NOT_FOUND" : "VALIDATION",
			matches.length === 0
				? `Nothing in ${sectionName(section)} matches "${words}".`
				: `"${words}" matches ${matches.length} items in ${sectionName(section)}; use more of its words.`,
		);
	}
	return matches[0]!;
}

/** Adds an item after the section's last list line, in the same list; a section with no list yet gets one after its last line. */
export function appendItem(scope: SectionScope, edits: LineEdits, text: string): void {
	const last = scope.lines.findLast((line) => LIST_LINE.test(line.text));
	if (last) edits.insertAfter(last, [text]);
	else edits.insertParagraph(scope.end, text);
}

/** Adds an item before the section's first one (newest first), or after its last. */
export function prependItem(scope: SectionScope, edits: LineEdits, text: string): void {
	const first = scope.lines.find((line) => ITEM_LINE.test(line.text));
	if (first) edits.insertBefore(first, [text]);
	else appendItem(scope, edits, text);
}

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
				if (value !== null && value !== undefined) out.push(value);
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
