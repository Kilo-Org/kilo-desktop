import { KernelError } from "@kilo-desktop/kernel";

import type { SectionRole, Workbook, WorkbookSectionRef } from "../contracts";
import {
	CHECKBOX_LINE,
	INDENTED,
	ITEM_LINE,
	LIST_LINE,
	NOTE_LINE,
	STEP_LINE,
	SUPERSEDED_LINE,
	checklistLine,
	journalLine,
	oneLine,
	questionLine,
	renumbered,
	stepExtent,
	stepLine,
	stepParts,
	stepTaskIndices,
	supersededLine,
	taskLine,
	withStatus,
	withTitleAndIntent,
	type JournalEntry,
	type StepStatus,
} from "./items";
import type { PagesToolCaller } from "./pages-tools";
import { sectionScope, type Block, type Line, type SectionScope } from "./section-scope";

/** Where to read or write: a page (the Brief without one), and a section's heading on it. */
type Target = Pick<WorkbookSectionRef, "pageId" | "heading">;

interface ReadPage {
	readonly revision: string;
	readonly blocks: readonly Block[];
}

/** What an item added to a section says; which parts apply depends on the section's type. */
export interface NewItem {
	/** A step's title, a checklist item, a journal entry's headline or a question. */
	readonly text: string;
	/** A step's intent, a checklist item's or question's context, a journal entry's body. */
	readonly detail?: string | undefined;
	/** steps: the new step's tasks. */
	readonly tasks?: readonly string[] | undefined;
	/** journal: the section's labelled fields. */
	readonly fields?: Readonly<Record<string, string>> | undefined;
	/** journal: who wrote it, when it matters. */
	readonly who?: string | undefined;
	/** journal: words from an entry in the same section that this one replaces. */
	readonly supersedes?: string | undefined;
}

export interface StatusChange {
	readonly status: StepStatus;
	/** steps: what was done. */
	readonly result?: string;
	/** steps: the commit or PR. */
	readonly link?: string;
	/** steps: why it's blocked, or why a done step has no link. */
	readonly reason?: string;
}

/**
 * Writes workbook items into Pages in each section type's format (items.ts),
 * so agents never hand-edit them, and enforces each section's rules. A
 * section is the part of a page under its heading, or a whole page; reads and
 * writes stay within it, and a missing heading is added at the end of the
 * page. Every write reads the page first and sends its revision; a write that
 * loses a race with another writer is retried once on the fresh page, which
 * is enough for concurrent agents adding items.
 */
export class WorkbookWriter {
	constructor(
		private readonly pages: PagesToolCaller,
		private readonly workbook: Workbook,
		private readonly today: () => string,
	) {}

	section(id: string): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.id === id);
		if (!section) {
			const ids = this.workbook.sections.map((candidate) => candidate.id).join(", ");
			throw new KernelError("NOT_FOUND", `This workbook has no "${id}" section (it has: ${ids}).`);
		}
		return section;
	}

	withRole(role: SectionRole): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.role === role);
		if (!section) throw new KernelError("NOT_FOUND", `This workbook has no ${role} section.`);
		return section;
	}

	async read(target: Target): Promise<string> {
		const page = await this.#read(target);
		if (!target.heading) {
			return page.blocks
				.map((block) => block.markdown ?? "")
				.join("\n\n")
				.trim();
		}
		return sectionScope(page.blocks, target.heading)
			.lines.map((line) => line.text)
			.join("\n")
			.trim();
	}

	/** Adds an item to a section in its type's format. Returns what was written, and a new step's number. */
	async addItem(sectionId: string, item: NewItem): Promise<{ written: string; step?: number }> {
		const section = this.section(sectionId);
		switch (section.type) {
			case "steps": {
				let number = 0;
				const written = await this.#change(section, (scope, edits) => {
					number = 1 + Math.max(0, ...stepLines(scope).map((line) => stepParts(line.text)!.number));
					const text = [
						stepLine(number, item.text, item.detail ?? ""),
						...(item.tasks ?? []).filter((task) => task.trim()).map((task) => taskLine(task)),
					].join("\n");
					appendItem(scope, edits, text);
					return text;
				});
				return { written, step: number };
			}
			case "checklist":
				return {
					written: await this.#change(section, (scope, edits) => {
						const text = checklistLine(item.text, item.detail);
						appendItem(scope, edits, text);
						return text;
					}),
				};
			case "questions":
				return {
					written: await this.#change(section, (scope, edits) => {
						const text = questionLine(item.text, item.detail);
						appendItem(scope, edits, text);
						return text;
					}),
				};
			case "journal": {
				if (section.role === "handoff") {
					throw new KernelError("VALIDATION", "Use hand_off for Where we left off.");
				}
				const entry: JournalEntry = {
					headline: item.text,
					...(item.detail ? { body: item.detail } : {}),
					...(item.fields ? { fields: item.fields } : {}),
					...(item.who ? { who: item.who } : {}),
				};
				return {
					written: await this.#change(section, (scope, edits) => {
						const text = journalLine(section, entry, this.today());
						if (item.supersedes) {
							const old = findItem(
								scope,
								item.supersedes,
								section,
								(line) => !SUPERSEDED_LINE.test(line),
							);
							edits.set(old, supersededLine(old.text, item.text, this.today()));
						}
						addEntry(scope, edits, text, section.order);
						return text;
					}),
				};
			}
			case "text":
				throw new KernelError("VALIDATION", "Use write_section for a text section.");
		}
	}

	/** Sets a step's status (checkbox and ` · status` suffix), or ticks a checklist item. Returns its line. */
	async setStatus(sectionId: string, item: string, change: StatusChange): Promise<string> {
		const section = this.section(sectionId);
		if (section.type === "checklist") {
			if (change.status !== "done" && change.status !== "todo") {
				throw new KernelError("VALIDATION", "A checklist item is either done or todo.");
			}
			return this.#change(section, (scope, edits) => {
				const line = findItem(scope, item, section, (text) => CHECKBOX_LINE.test(text));
				const text = line.text.replace(
					/^- \[[ xX]\]/,
					`- [${change.status === "done" ? "x" : " "}]`,
				);
				edits.set(line, text);
				return text;
			});
		}
		if (section.type !== "steps") {
			throw new KernelError("VALIDATION", `${name(section)} has no statuses.`);
		}
		const requires = section.requires ?? [];
		if (change.status === "blocked" && !change.reason?.trim()) {
			throw new KernelError("VALIDATION", "Say what blocks it (reason).");
		}
		if (change.status === "done") {
			if (!change.result?.trim())
				throw new KernelError("VALIDATION", "Say what was done (result).");
			if (requires.includes("link-or-reason") && !change.link?.trim() && !change.reason?.trim()) {
				throw new KernelError(
					"VALIDATION",
					"A done step needs its link (the commit or PR), or the reason there is none.",
				);
			}
		}
		return this.#withStep(section, item, (lines, at) => {
			if (change.status === "done" && requires.includes("tasks-ticked")) {
				const open = stepTaskIndices(lines, at).filter((index) =>
					/^\s*- \[ \]/.test(lines[index]!),
				);
				if (open.length > 0) {
					const list = open.map((index) => lines[index]!.replace(/^\s*- \[ \] /, "")).join("; ");
					throw new KernelError(
						"VALIDATION",
						`Step ${item} still has open tasks: ${list}. Tick them, or move them to Follow-ups, first.`,
					);
				}
			}
			const note =
				change.status === "done"
					? `${oneLine(change.result!)}${change.link?.trim() ? ` (${oneLine(change.link)})` : change.reason?.trim() ? ` (${oneLine(change.reason)})` : ""}`
					: change.reason;
			lines[at] = withStatus(lines[at]!, change.status, note);
			return lines[at]!;
		});
	}

	/** Adds a task under a plan step, after its other tasks. Returns the task's line. */
	async addTask(step: string, text: string): Promise<string> {
		return this.#withStep(this.withRole("plan"), step, (lines, at) => {
			const tasks = stepTaskIndices(lines, at);
			const indent = tasks.length > 0 ? INDENTED.exec(lines[tasks.at(-1)!]!)![1]! : undefined;
			const line = taskLine(text, indent);
			lines.splice(stepExtent(lines, at) + 1, 0, line);
			return line;
		});
	}

	/** Ticks (or unticks) one of a plan step's tasks, found by words from it. Returns its line. */
	async setTaskDone(step: string, task: string, done: boolean): Promise<string> {
		return this.#withStep(this.withRole("plan"), step, (lines, at) => {
			const wanted = oneLine(task).toLowerCase();
			const matches = stepTaskIndices(lines, at).filter((index) =>
				lines[index]!.toLowerCase().includes(wanted),
			);
			if (matches.length !== 1) {
				throw new KernelError(
					matches.length === 0 ? "NOT_FOUND" : "VALIDATION",
					matches.length === 0
						? `Step ${step} has no task matching "${task}".`
						: `"${task}" matches ${matches.length} of step ${step}'s tasks; use more of its words.`,
				);
			}
			const index = matches[0]!;
			lines[index] = lines[index]!.replace(/^(\s*)- \[[ xX]\]/, `$1- [${done ? "x" : " "}]`);
			return lines[index]!;
		});
	}

	/** Renames a plan step or changes its intent, keeping its number, tasks and status. */
	async editStep(step: string, change: { title?: string; intent?: string }): Promise<string> {
		if (!change.title?.trim() && !change.intent?.trim()) {
			throw new KernelError("VALIDATION", "Give the step a new title or intent.");
		}
		return this.#withStep(this.withRole("plan"), step, (lines, at) => {
			lines[at] = withTitleAndIntent(lines[at]!, change.title?.trim(), change.intent?.trim());
			return lines[at]!;
		});
	}

	/**
	 * Moves a plan step (with its tasks) before or after another, then
	 * renumbers every step in order. Returns how the numbers changed, so text
	 * that mentions steps by number can be updated.
	 */
	async moveStep(step: string, place: { before?: string; after?: string }): Promise<Renumbering> {
		const anchor = place.before ?? place.after;
		if (!anchor || (place.before && place.after)) {
			throw new KernelError("VALIDATION", "Say which step to put it before, or after.");
		}
		return this.#withSteps(this.withRole("plan"), (lines) => {
			const from = findStep(lines, step);
			const to = findStep(lines, anchor);
			if (from === to) throw new KernelError("VALIDATION", "A step can't move next to itself.");
			const moved = lines.splice(from, stepExtent(lines, from) - from + 1);
			const target = findStep(lines, anchor);
			const at = place.before ? target : stepExtent(lines, target) + 1;
			lines.splice(at, 0, ...moved);
		});
	}

	/** Removes an item: a step that isn't done (its tasks with it, then the rest renumber), a checklist item or a question. */
	async removeItem(
		sectionId: string,
		item: string,
	): Promise<{ removed: string; renumbered?: Renumbering }> {
		const section = this.section(sectionId);
		if (section.type === "steps") {
			let removed = "";
			const changes = await this.#withSteps(section, (lines) => {
				const at = findStep(lines, item);
				if (stepParts(lines[at]!)!.status === "done") {
					throw new KernelError("VALIDATION", "A done step is part of the record; leave it.");
				}
				removed = lines[at]!;
				lines.splice(at, stepExtent(lines, at) - at + 1);
			});
			return { removed, renumbered: changes };
		}
		if (section.type === "journal") {
			throw new KernelError(
				"VALIDATION",
				"Journal entries are never removed: supersede it instead.",
			);
		}
		if (section.type === "text") {
			throw new KernelError("VALIDATION", "Use write_section for a text section.");
		}
		return {
			removed: await this.#change(section, (scope, edits) => {
				const line = findItem(scope, item, section);
				edits.remove(line);
				return line.text;
			}),
		};
	}

	/** Strikes a journal entry through, saying what replaced it. Returns its new line. */
	async supersede(sectionId: string, item: string, by: string): Promise<string> {
		const section = this.section(sectionId);
		if (section.type !== "journal") {
			throw new KernelError(
				"VALIDATION",
				`Only journal entries are superseded; ${name(section)} isn't a journal.`,
			);
		}
		return this.#change(section, (scope, edits) => {
			const line = findItem(scope, item, section, (text) => !SUPERSEDED_LINE.test(text));
			const text = supersededLine(line.text, by, this.today());
			edits.set(line, text);
			return text;
		});
	}

	/** Removes an answered question; with `record`, first records the answer as an entry in that journal. */
	async answerQuestion(
		question: string,
		answer: { recordIn?: string; entry?: Omit<NewItem, "supersedes" | "tasks"> },
	): Promise<{ removed: string; recorded?: string }> {
		const questions = this.workbook.sections.filter((section) => section.type === "questions");
		if (questions.length === 0)
			throw new KernelError("NOT_FOUND", "This workbook has no questions section.");
		const section = await this.#sectionWith(questions, question);
		let recorded: string | undefined;
		if (answer.recordIn) {
			if (!answer.entry) throw new KernelError("VALIDATION", "Say what to record.");
			if (this.section(answer.recordIn).type !== "journal") {
				throw new KernelError(
					"VALIDATION",
					"Record an answer in a journal section, such as Decisions.",
				);
			}
			recorded = (await this.addItem(answer.recordIn, answer.entry)).written;
		}
		return { ...(await this.removeItem(section.id, question)), ...(recorded ? { recorded } : {}) };
	}

	/** Replaces a text section's content, keeping the note under its heading. */
	async writeSection(sectionId: string, markdown: string, userConfirmed: boolean): Promise<void> {
		const section = this.section(sectionId);
		if (section.type !== "text") {
			throw new KernelError(
				"VALIDATION",
				`${name(section)} holds items: add or change them instead.`,
			);
		}
		if ((section.protected || section.role === "goal") && !userConfirmed) {
			throw new KernelError(
				"VALIDATION",
				`${name(section)} changes only when the user asks: propose the change, and write it once they confirm (userConfirmed).`,
			);
		}
		await this.#withRetry(async () => {
			const page = await this.#read(section);
			await this.#edit(
				section,
				page.revision,
				replaceBodyEdits(page.blocks, section.heading, markdown.trim()),
			);
		});
	}

	/**
	 * Replaces the handoff (keeping its note) with a new entry, and adds the
	 * same entry to the handoff's history journal when it has one.
	 */
	async handOff(entry: JournalEntry): Promise<{ written: string; history?: string }> {
		const handoff = this.withRole("handoff");
		const written = journalLine({ ...handoff, fields: [] }, { ...entry, fields: {} }, this.today());
		const history = handoff.history ? this.section(handoff.history) : undefined;
		if (history) {
			await this.#change(history, (scope, edits) => {
				addEntry(scope, edits, written, history.order);
				return written;
			});
		}
		await this.#withRetry(async () => {
			const page = await this.#read(handoff);
			await this.#edit(
				handoff,
				page.revision,
				replaceBodyEdits(page.blocks, handoff.heading, written),
			);
		});
		return { written, ...(history ? { history: history.id } : {}) };
	}

	/** The one of `sections` holding an item matching `words`. */
	async #sectionWith(
		sections: readonly WorkbookSectionRef[],
		words: string,
	): Promise<WorkbookSectionRef> {
		if (sections.length === 1) return sections[0]!;
		for (const section of sections) {
			const page = await this.#read(section);
			const scope = sectionScope(page.blocks, section.heading);
			if (
				scope.lines.some(
					(line) =>
						ITEM_LINE.test(line.text) && line.text.toLowerCase().includes(words.toLowerCase()),
				)
			) {
				return section;
			}
		}
		throw new KernelError("NOT_FOUND", `No open question matches "${words}".`);
	}

	/** Reads the section, lets `change` record line edits, and sends them. */
	async #change<T>(
		section: WorkbookSectionRef,
		change: (scope: SectionScope, edits: LineEdits) => T,
	): Promise<T> {
		return this.#withRetry(async () => {
			const page = await this.#read(section);
			const scope = sectionScope(page.blocks, section.heading);
			const edits = new LineEdits();
			const result = change(scope, edits);
			const operations =
				scope.found || !section.heading
					? edits.operations()
					: [
							{
								op: "insert_markdown",
								markdown: `## ${section.heading}\n\n${edits.pendingText()}`,
							},
						];
			await this.#edit(section, page.revision, operations);
			return result;
		});
	}

	/**
	 * Finds one plan step (a top-level item, by number or words from it) and
	 * rewrites its block with `change`, which edits the block's lines in place;
	 * a step's tasks are the indented lines under it in the same block.
	 */
	async #withStep<T>(
		section: WorkbookSectionRef,
		step: string,
		change: (lines: string[], at: number) => T,
	): Promise<T> {
		return this.#withRetry(async () => {
			const page = await this.#read(section);
			const matches = stepLines(sectionScope(page.blocks, section.heading)).filter((line) =>
				matchesStep(line.text, step),
			);
			if (matches.length !== 1) throw stepNotFound(step, matches.length);
			const { block, index } = matches[0]!;
			const lines = (block.markdown ?? "").split("\n");
			const result = change(lines, index);
			await this.#edit(section, page.revision, [
				{ op: "replace_block_markdown", node_id: block.node_id, markdown: lines.join("\n") },
			]);
			return result;
		});
	}

	/** Rewrites the block holding every plan step with `change`, then renumbers the steps in order. */
	async #withSteps(
		section: WorkbookSectionRef,
		change: (lines: string[]) => void,
	): Promise<Renumbering> {
		return this.#withRetry(async () => {
			const page = await this.#read(section);
			const steps = stepLines(sectionScope(page.blocks, section.heading));
			const block = steps[0]?.block;
			if (!block) throw new KernelError("NOT_FOUND", "The Plan has no steps.");
			if (steps.some((line) => line.block.node_id !== block.node_id)) {
				throw new KernelError(
					"UNAVAILABLE",
					"The Plan's steps are split across blocks; edit them in Pages.",
				);
			}
			const lines = (block.markdown ?? "").split("\n");
			change(lines);
			const renumbering: Renumbering = [];
			let number = 0;
			for (let index = 0; index < lines.length; index += 1) {
				const parts = stepParts(lines[index]!);
				if (!parts) continue;
				number += 1;
				if (parts.number !== number) renumbering.push({ from: parts.number, to: number });
				lines[index] = renumbered(lines[index]!, number);
			}
			await this.#edit(section, page.revision, [
				{ op: "replace_block_markdown", node_id: block.node_id, markdown: lines.join("\n") },
			]);
			return renumbering;
		});
	}

	#target(target: Target) {
		return target.pageId ? { page_id: target.pageId } : { project_id: this.workbook.projectId };
	}

	async #read(target: Target): Promise<ReadPage> {
		const page = (await this.pages.call("read_page", {
			...this.#target(target),
			comments: "none",
		})) as Partial<ReadPage> | undefined;
		if (!page?.revision) throw new KernelError("UNAVAILABLE", "Pages didn't return the page.");
		return { revision: page.revision, blocks: page.blocks ?? [] };
	}

	async #edit(target: Target, revision: string, operations: unknown[]): Promise<void> {
		if (operations.length === 0) return;
		await this.pages.call("edit_page", {
			...this.#target(target),
			revision,
			nonce: globalThis.crypto.randomUUID().replaceAll("-", ""),
			operations,
		});
	}

	async #withRetry<T>(write: () => Promise<T>): Promise<T> {
		try {
			return await write();
		} catch (error) {
			if (!String(error).includes("stale_revision")) throw error;
			return write();
		}
	}
}

/** Steps whose numbers changed: `from` is the old number, `to` the new. */
export type Renumbering = { from: number; to: number }[];

const name = (section: WorkbookSectionRef) => section.title ?? section.id;

function stepLines(scope: SectionScope): Line[] {
	return scope.lines.filter((line) => STEP_LINE.test(line.text));
}

function matchesStep(line: string, step: string): boolean {
	const wanted = step.trim().replace(/\.$/, "");
	if (/^\d+$/.test(wanted)) return stepParts(line)?.number === Number(wanted);
	return line.toLowerCase().includes(wanted.toLowerCase());
}

function stepNotFound(step: string, count: number): KernelError {
	return new KernelError(
		count === 0 ? "NOT_FOUND" : "VALIDATION",
		count === 0
			? `No plan step matches "${step}".`
			: `"${step}" matches ${count} plan steps; use the step number.`,
	);
}

/** The index of the one step line in `lines` matching `step`. */
function findStep(lines: readonly string[], step: string): number {
	const matches = lines.flatMap((line, index) =>
		STEP_LINE.test(line) && matchesStep(line, step) ? [index] : [],
	);
	if (matches.length !== 1) throw stepNotFound(step, matches.length);
	return matches[0]!;
}

/** The one top-level item of the section matching `words` (and `accept`, when given). */
function findItem(
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
				? `Nothing in ${name(section)} matches "${words}".`
				: `"${words}" matches ${matches.length} items in ${name(section)}; use more of its words.`,
		);
	}
	return matches[0]!;
}

/** Adds an item after the section's last list line, in the same list; a section with no list yet gets one after its last line. */
function appendItem(scope: SectionScope, edits: LineEdits, text: string): void {
	const last = scope.lines.findLast((line) => LIST_LINE.test(line.text));
	if (last) edits.insertAfter(last, [text]);
	else edits.insertParagraph(scope.end, text);
}

/** Adds a journal entry: newest first before the first entry, otherwise after the last. */
function addEntry(
	scope: SectionScope,
	edits: LineEdits,
	text: string,
	order: WorkbookSectionRef["order"],
): void {
	const first = scope.lines.find((line) => ITEM_LINE.test(line.text));
	if (order === "newest-first" && first) edits.insertBefore(first, [text]);
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
class LineEdits {
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
