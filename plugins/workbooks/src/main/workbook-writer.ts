import { KernelError } from "@kilo-desktop/kernel";

import type { SectionType, Workbook, WorkbookSectionRef } from "../contracts";
import {
	INSERT_IMPLEMENTATIONS,
	type Insert,
	type InsertContext,
	type NewItem,
	type Renumbering,
	type StatusChange,
} from "./inserts";
import { LineEdits, sectionName } from "./inserts/helpers";
import { setActivity } from "./inserts/activity";
import { handOff, type Handoff } from "./inserts/handoff";
import { addTask, editStep, moveStep, setTaskDone } from "./inserts/plan";
import { answerQuestion } from "./inserts/questions";
import type { PagesToolCaller } from "./pages-tools";
import { sectionScope, type Block } from "./section-scope";

export { replaceBodyEdits } from "./inserts/helpers";
export type { NewItem, Renumbering, StatusChange } from "./inserts";

/** Where to read or write: a page (the Brief without one), and a section's heading on it. */
type Target = Pick<WorkbookSectionRef, "pageId" | "heading">;

interface ReadPage {
	readonly revision: string;
	readonly blocks: readonly Block[];
}

type Action = "add" | "setStatus" | "remove" | "supersede" | "write";

/**
 * Writes workbook items into Pages through each section's insert
 * (inserts/), which owns its format and rules; this class owns only Pages:
 * finding sections, reading pages, sending edits. A section is the part of a
 * page under its heading, or a whole page; a missing heading is added at the
 * end of the page. Every write reads the page first and sends its revision;
 * a write that loses a race with another writer is retried once on the fresh
 * page, which is enough for concurrent agents adding items.
 */
export class WorkbookWriter {
	readonly #context: InsertContext;

	constructor(
		private readonly pages: PagesToolCaller,
		private readonly workbook: Workbook,
		today: () => string,
		now: () => Date = () => new Date(),
	) {
		this.#context = {
			workbook,
			today,
			now,
			section: (id) => this.section(id),
			change: (section, change) =>
				this.#withRetry(async () => {
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
				}),
			rewrite: (section, compose) =>
				this.#withRetry(async () => {
					const page = await this.#read(section);
					const { operations, result } = compose(page.blocks);
					await this.#edit(section, page.revision, operations);
					return result;
				}),
		};
	}

	section(id: string): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.id === id);
		if (!section) {
			const ids = this.workbook.sections.map((candidate) => candidate.id).join(", ");
			throw new KernelError("NOT_FOUND", `This workbook has no "${id}" section (it has: ${ids}).`);
		}
		return section;
	}

	/** The workbook's one section of a one-per-workbook insert (goal, plan, handoff). */
	only(type: SectionType): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.type === type);
		if (!section) throw new KernelError("NOT_FOUND", `This workbook has no ${type} section.`);
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

	/** Adds an item in the section's insert's format. Returns what was written, and a new step's number. */
	addItem(sectionId: string, item: NewItem): Promise<{ written: string; step?: number }> {
		const section = this.section(sectionId);
		return this.#insert(section, "add").add!(this.#context, section, item);
	}

	/** Sets a plan step's status, or ticks a todo item. Returns its line. */
	setStatus(sectionId: string, item: string, change: StatusChange): Promise<string> {
		const section = this.section(sectionId);
		return this.#insert(section, "setStatus").setStatus!(this.#context, section, item, change);
	}

	removeItem(
		sectionId: string,
		item: string,
	): Promise<{ removed: string; renumbered?: Renumbering }> {
		const section = this.section(sectionId);
		return this.#insert(section, "remove").remove!(this.#context, section, item);
	}

	supersede(sectionId: string, item: string, by: string): Promise<string> {
		const section = this.section(sectionId);
		return this.#insert(section, "supersede").supersede!(this.#context, section, item, by);
	}

	writeSection(
		sectionId: string,
		markdown: string,
		options: { userConfirmed?: boolean; change?: string; part?: string } = {},
	): Promise<{ history?: string }> {
		const section = this.section(sectionId);
		return this.#insert(section, "write").write!(this.#context, section, markdown, options);
	}

	addTask(step: string, text: string): Promise<string> {
		return addTask(this.#context, this.only("plan"), step, text);
	}

	setTaskDone(step: string, task: string, done: boolean): Promise<string> {
		return setTaskDone(this.#context, this.only("plan"), step, task, done);
	}

	editStep(step: string, change: { title?: string; intent?: string }): Promise<string> {
		return editStep(this.#context, this.only("plan"), step, change);
	}

	moveStep(step: string, place: { before?: string; after?: string }): Promise<Renumbering> {
		return moveStep(this.#context, this.only("plan"), step, place);
	}

	answerQuestion(
		question: string,
		answer: { recordIn?: string; entry?: Omit<NewItem, "supersedes" | "tasks"> },
	): Promise<{ removed: string; recorded?: string }> {
		return answerQuestion(this.#context, question, answer, (section) => this.#read(section));
	}

	handOff(entry: Handoff): Promise<{ written: string; history?: string }> {
		return handOff(this.#context, this.only("handoff"), entry);
	}

	/**
	 * Sets what `who` is doing in the activity section, or with no `doing`
	 * takes them off it; does nothing in a workbook without one.
	 */
	async setActivity(who: string, doing: string | undefined): Promise<string | undefined> {
		const section = this.workbook.sections.find((candidate) => candidate.type === "activity");
		return section ? setActivity(this.#context, section, who, doing) : undefined;
	}

	/** The section's insert, when it supports `action`; otherwise says why not. */
	#insert(section: WorkbookSectionRef, action: Action): Insert {
		const insert = INSERT_IMPLEMENTATIONS[section.type];
		if (insert[action]) return insert;
		throw new KernelError(
			"VALIDATION",
			insert.refusals?.[action] ?? `${sectionName(section)} (${section.type}) can't do that.`,
		);
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
