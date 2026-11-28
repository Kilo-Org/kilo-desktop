import type { STEP_STATUSES, Workbook, WorkbookSectionRef } from "../../contracts";
import type { Block, SectionScope } from "../section-scope";
import type { LineEdits } from "./helpers";

export type StepStatus = (typeof STEP_STATUSES)[number];

/** What an item added to a section says; each insert uses the parts it understands. */
export interface NewItem {
	/** A step's title, a todo item, a log entry's headline or a question. */
	readonly text: string;
	/** A step's intent, a todo item's or question's context, a log entry's body. */
	readonly detail?: string | undefined;
	/** plan: the new step's tasks. */
	readonly tasks?: readonly string[] | undefined;
	/** log, handoff: who wrote it, when it matters. */
	readonly who?: string | undefined;
	/** log: words from an entry in the same section that this one replaces. */
	readonly supersedes?: string | undefined;
}

export interface StatusChange {
	readonly status: StepStatus;
	/** plan: what was done. */
	readonly result?: string;
	/** plan: a link to what the step produced (optional). */
	readonly link?: string;
	/** plan: why it's blocked. */
	readonly reason?: string;
}

/** Steps whose numbers changed: `from` is the old number, `to` the new. */
export type Renumbering = { from: number; to: number }[];

/**
 * What an insert may do to Pages, given by the writer: read and change one
 * section's lines (retrying a lost race), rewrite blocks, and reach the
 * workbook's other sections. Inserts know their own formats; the writer
 * knows Pages.
 */
export interface InsertContext {
	readonly workbook: Workbook;
	readonly today: () => string;
	readonly now: () => Date;
	section(id: string): WorkbookSectionRef;
	/** Reads `section`, lets `change` record line edits, and sends them. */
	change<T>(
		section: WorkbookSectionRef,
		change: (scope: SectionScope, edits: LineEdits) => T,
	): Promise<T>;
	/** Reads `section`'s page and sends the operations `compose` returns. */
	rewrite<T>(
		section: WorkbookSectionRef,
		compose: (blocks: readonly Block[]) => { operations: unknown[]; result: T },
	): Promise<T>;
}

/**
 * One pre-printed section: everything about how it's written and changed.
 * Each insert owns its format outright, so one can change without touching
 * the others; an action an insert doesn't support is left out, and the tools
 * say so.
 */
export interface Insert {
	/** What a new workbook's page shows under the section's heading and note. */
	starter?(): string | undefined;
	add?(
		context: InsertContext,
		section: WorkbookSectionRef,
		item: NewItem,
	): Promise<{ written: string; step?: number }>;
	setStatus?(
		context: InsertContext,
		section: WorkbookSectionRef,
		item: string,
		change: StatusChange,
	): Promise<string>;
	remove?(
		context: InsertContext,
		section: WorkbookSectionRef,
		item: string,
	): Promise<{ removed: string; renumbered?: Renumbering }>;
	supersede?(
		context: InsertContext,
		section: WorkbookSectionRef,
		item: string,
		by: string,
	): Promise<string>;
	write?(
		context: InsertContext,
		section: WorkbookSectionRef,
		markdown: string,
		options: { userConfirmed?: boolean; part?: string },
	): Promise<{ history?: string }>;
	/** Why an unsupported action was refused, when there's something more useful to say than "can't". */
	readonly refusals?: Partial<
		Record<"add" | "setStatus" | "remove" | "supersede" | "write", string>
	>;
}
