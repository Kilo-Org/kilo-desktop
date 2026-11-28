import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	KernelError,
} from "@kilo-desktop/kernel";

import type { STEP_STATUSES, Workbook, WorkbookSectionRef } from "./workbooks";

/**
 * Section types (docs/workbooks): the finished kinds of section workbook
 * templates are built from, like pre-printed stationery inserts. Each is
 * contributed through `kilo.workbooks/section-type` (kilo.workbooks ships its
 * built-ins the same way) and owns everything about its sections: format,
 * rules, starting content, default title and label, and instructions for
 * agents. A section type never touches Pages: it reads and edits its
 * section's lines through the `SectionTypeContext` it is given.
 */

/** One line of a section, as a section type sees it. */
export interface SectionLine {
	readonly text: string;
}

/**
 * Line edits to one section, sent together. Lines are the ones the edit was
 * given; a line set to text with newlines becomes several lines.
 */
export interface SectionEdits {
	set(line: SectionLine, text: string): void;
	remove(line: SectionLine): void;
	insertBefore(line: SectionLine, lines: readonly string[]): void;
	insertAfter(line: SectionLine, lines: readonly string[]): void;
	/** A list item after the section's last list line, or a new list at its end. */
	append(text: string): void;
	/** A list item before the section's first top-level item (newest first), or `append`. */
	prepend(text: string): void;
	/** A paragraph of its own at the end of the section. */
	appendParagraph(text: string): void;
	/** A paragraph of its own after `line`. */
	insertParagraphAfter(line: SectionLine, text: string): void;
}

/** What a section type may do: read and edit its workbook's sections. */
export interface SectionTypeContext {
	readonly workbook: Workbook;
	today(): string;
	now(): Date;
	/** One of the workbook's sections, by id; NOT_FOUND names the ones there are. */
	section(id: string): WorkbookSectionRef;
	/** The section's markdown (without its heading). */
	read(section: WorkbookSectionRef): Promise<string>;
	/**
	 * Reads the section and lets `change` record edits to its lines, then
	 * sends them; retried once on the fresh page when another writer got
	 * there first, so `change` must only compute from what it is given.
	 */
	edit<T>(
		section: WorkbookSectionRef,
		change: (lines: readonly SectionLine[], edits: SectionEdits) => T,
	): Promise<T>;
	/** Replaces the section's content, keeping the italic line that leads it. */
	replaceBody(section: WorkbookSectionRef, markdown: string): Promise<void>;
}

/** What an item added to a section says; each section type uses the parts it understands. */
export interface NewItem {
	/** A step's title, a todo item, a log entry's headline, a question, a part's title. */
	readonly text: string;
	/** A step's intent, a todo item's or question's context, a log entry's body, a part's content. */
	readonly detail?: string | undefined;
	/** Steps: the new step's tasks. */
	readonly tasks?: readonly string[] | undefined;
	/** Who wrote it, when it matters. */
	readonly who?: string | undefined;
	/** Logs: words from an entry in the same section that this one replaces. */
	readonly supersedes?: string | undefined;
}

export type StepStatus = (typeof STEP_STATUSES)[number];

export interface StatusChange {
	readonly status: StepStatus;
	/** What was done. */
	readonly result?: string | undefined;
	/** A link to it (optional). */
	readonly link?: string | undefined;
	/** Why it's blocked. */
	readonly reason?: string | undefined;
}

/** A type-specific action agents reach through `section_action` (or a dedicated tool). */
export interface SectionAction {
	/** What it does, and what its input means, for agents. */
	readonly description: string;
	readonly input: z.ZodType;
	run(context: SectionTypeContext, section: WorkbookSectionRef, input: never): Promise<unknown>;
}

/** The generic actions, each reached through its workbook tool. */
export type SectionVerb = "add" | "setStatus" | "remove" | "supersede" | "write";

/**
 * A section type: what a `section-type` contribution implements, in main.
 * It implements only the generic actions it supports; the tools say why the
 * others are refused (`refusals`, or a plain "can't").
 */
export interface SectionTypeDefinition {
	/** At most one section of this type in a workbook. */
	readonly single: boolean;
	/** A section's heading when its template gives none. */
	readonly title: string;
	/** What belongs in a section of this type, when its template doesn't say. */
	readonly collects: string;
	/** How to work with it, given to every chat (a section's own instructions follow). */
	readonly usage: string;
	/** What a new section starts with, below its label. */
	starter?(): string | undefined;
	add?(
		context: SectionTypeContext,
		section: WorkbookSectionRef,
		item: NewItem,
	): Promise<{ readonly written: string } & Record<string, unknown>>;
	setStatus?(
		context: SectionTypeContext,
		section: WorkbookSectionRef,
		item: string,
		change: StatusChange,
	): Promise<string>;
	remove?(
		context: SectionTypeContext,
		section: WorkbookSectionRef,
		item: string,
	): Promise<{ readonly removed: string } & Record<string, unknown>>;
	supersede?(
		context: SectionTypeContext,
		section: WorkbookSectionRef,
		item: string,
		by: string,
	): Promise<string>;
	write?(
		context: SectionTypeContext,
		section: WorkbookSectionRef,
		markdown: string,
		options: { readonly userConfirmed?: boolean; readonly part?: string },
	): Promise<Record<string, unknown>>;
	/** Type-specific actions, by name (lowercase-dashes or underscores). */
	readonly actions?: Readonly<Record<string, SectionAction>>;
	readonly refusals?: Partial<Record<SectionVerb, string>>;
}

/** What templates need to know of a section type without running it. */
export type SectionTypeFacts = Pick<SectionTypeDefinition, "single" | "title" | "collects">;

/**
 * A section type offered for workbook templates; its contribution id is the
 * type's id (`{ "type": "calendar" }`). Section types that fail validation,
 * or repeat an id a higher-priority contribution already offers, are skipped
 * and reported in `kilo.workbooks/section-types`; a template using a type
 * nobody offers is skipped until one is.
 */
export const SectionTypePoint = defineExtensionPoint({
	id: "kilo.workbooks/section-type",
	kind: "additive",
	description: "A section type workbook templates can use.",
	implementation: implementation<SectionTypeDefinition>("main"),
});

export const sectionTypeSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	collects: z.string(),
	usage: z.string(),
	single: z.boolean(),
	actions: z.array(z.object({ name: z.string(), description: z.string() })),
	/** The contribution that provides it, e.g. `kilo.workbooks/plan`. */
	source: z.string(),
});
export type SectionTypeSummary = z.output<typeof sectionTypeSummarySchema>;

/** The section types on offer, from every `section-type` contribution. */
export const SectionTypes = defineDomainObject({
	id: "kilo.workbooks/section-types",
	home: "main",
	state: z.object({
		types: z.array(sectionTypeSummarySchema),
		/** Contributions that were skipped, and why. */
		issues: z.array(z.object({ source: z.string(), message: z.string() })),
	}),
});

// Text helpers section types share (built-in or contributed); a type that needs to differ stops using one.

/** A top-level list item. */
export const ITEM_LINE = /^- /;
export const LIST_LINE = /^\s*- /;
export const INDENTED = /^(\s+)\S/;
/** An italic line (`_…_` or `*…*`, not bold): a section's standing note. */
export const NOTE_LINE = /^(_|\*(?!\*))\S/;

const TRAILING_DATE = /\s*\(\d{4}-\d{2}-\d{2}(?:, [^)]*)?\)[.\s]*$/;

/** One line of text, without a trailing date (section types add their own). */
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

/** The one top-level item among `lines` matching `words` (and `accept`, when given). */
export function findItem<Line extends SectionLine>(
	lines: readonly Line[],
	words: string,
	section: Pick<WorkbookSectionRef, "title" | "id">,
	accept: (text: string) => boolean = () => true,
): Line {
	const wanted = oneLine(words).toLowerCase();
	const matches = lines.filter(
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
