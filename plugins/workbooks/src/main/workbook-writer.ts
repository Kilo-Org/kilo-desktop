import { KernelError } from "@kilo-desktop/kernel";

import {
	sectionName,
	type NewItem,
	type SectionTypeContext,
	type SectionTypeDefinition,
	type SectionVerb,
	type StatusChange,
	type Workbook,
	type WorkbookSectionRef,
} from "../contracts";
import type { PagesToolCaller } from "./pages-tools";
import { sectionScope, type Block } from "./section-scope";
import { LineEdits, replaceBodyEdits, sectionEdits } from "./section-edits";

export { replaceBodyEdits } from "./section-edits";

/** Where to read or write: a page (the Brief without one), and a section's heading on it. */
type Target = Pick<WorkbookSectionRef, "pageId" | "heading">;

interface ReadPage {
	readonly revision: string;
	readonly blocks: readonly Block[];
}

/**
 * Writes a workbook's sections through their section types
 * (`kilo.workbooks/section-type`), which own every format and rule; this
 * class owns only Pages: finding sections, reading pages, sending edits, and
 * the `SectionTypeContext` every type is given. A section is the part of a
 * page under its heading, or a whole page; a missing heading is added at the
 * end of the page. Every write reads the page first and sends its revision; a
 * write that loses a race with another writer is retried once on the fresh
 * page, which is enough for concurrent agents adding items. A section whose
 * type nobody offers can be read but not written.
 */
export class WorkbookWriter {
	readonly #context: SectionTypeContext;

	constructor(
		private readonly pages: PagesToolCaller,
		private readonly workbook: Workbook,
		private readonly types: (type: string) => SectionTypeDefinition | undefined,
		today: () => string,
		now: () => Date = () => new Date(),
	) {
		this.#context = {
			workbook,
			today,
			now,
			section: (id) => this.section(id),
			read: (section) => this.read(section),
			edit: (section, change) =>
				this.#withRetry(async () => {
					const page = await this.#read(section);
					const scope = sectionScope(page.blocks, section.heading);
					const edits = new LineEdits();
					const result = change(scope.lines, sectionEdits(scope, edits));
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
			replaceBody: (section, markdown) =>
				this.#withRetry(async () => {
					const page = await this.#read(section);
					await this.#edit(
						section,
						page.revision,
						replaceBodyEdits(page.blocks, section.heading, markdown),
					);
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

	workbookSections(): readonly WorkbookSectionRef[] {
		return this.workbook.sections;
	}

	/** Of the sections of `type`, the one holding an item matching `words` (the first, when there's one). */
	async holding(type: string, words: string): Promise<WorkbookSectionRef> {
		const candidates = this.workbook.sections.filter((section) => section.type === type);
		if (candidates.length === 0)
			throw new KernelError("NOT_FOUND", `This workbook has no ${type} section.`);
		if (candidates.length === 1) return candidates[0]!;
		const wanted = words.toLowerCase();
		const texts = await Promise.all(candidates.map((section) => this.read(section)));
		const index = texts.findIndex((text) =>
			text.split("\n").some((line) => /^- /.test(line) && line.toLowerCase().includes(wanted)),
		);
		if (index === -1)
			throw new KernelError("NOT_FOUND", `Nothing in a ${type} section matches "${words}".`);
		return candidates[index]!;
	}

	/** The workbook's one section of a type (the plan, the handoff…). */
	only(type: string): WorkbookSectionRef {
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

	addItem(sectionId: string, item: NewItem) {
		const section = this.section(sectionId);
		return this.#verb(section, "add").add!(this.#context, section, item);
	}

	setStatus(sectionId: string, item: string, change: StatusChange): Promise<string> {
		const section = this.section(sectionId);
		return this.#verb(section, "setStatus").setStatus!(this.#context, section, item, change);
	}

	removeItem(sectionId: string, item: string) {
		const section = this.section(sectionId);
		return this.#verb(section, "remove").remove!(this.#context, section, item);
	}

	supersede(sectionId: string, item: string, by: string): Promise<string> {
		const section = this.section(sectionId);
		return this.#verb(section, "supersede").supersede!(this.#context, section, item, by);
	}

	writeSection(
		sectionId: string,
		markdown: string,
		options: { userConfirmed?: boolean; part?: string } = {},
	) {
		const section = this.section(sectionId);
		return this.#verb(section, "write").write!(this.#context, section, markdown, options);
	}

	/** Runs a section type's own action (`actions`) on a section, validating its input. */
	async action(section: WorkbookSectionRef, name: string, input: unknown): Promise<unknown> {
		const definition = this.#type(section);
		const action = definition.actions?.[name];
		if (!action) {
			const names = Object.keys(definition.actions ?? {});
			throw new KernelError(
				"NOT_FOUND",
				`${sectionName(section)} (${section.type}) has no "${name}" action${
					names.length ? ` (it has: ${names.join(", ")})` : ""
				}.`,
			);
		}
		const parsed = action.input.safeParse(input);
		if (!parsed.success) {
			throw new KernelError(
				"VALIDATION",
				`"${name}" input: ${parsed.error.issues
					.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message)
					.join("; ")}`,
			);
		}
		return action.run(this.#context, section, parsed.data as never);
	}

	/** The section's type definition; refuses a section whose type nobody offers. */
	#type(section: WorkbookSectionRef): SectionTypeDefinition {
		const definition = this.types(section.type);
		if (!definition) {
			throw new KernelError(
				"UNAVAILABLE",
				`${sectionName(section)} is a "${section.type}" section, and that section type isn't installed.`,
			);
		}
		return definition;
	}

	/** The section's type, when it supports `verb`; otherwise says why not. */
	#verb(section: WorkbookSectionRef, verb: SectionVerb): SectionTypeDefinition {
		const definition = this.#type(section);
		if (definition[verb]) return definition;
		throw new KernelError(
			"VALIDATION",
			definition.refusals?.[verb] ?? `${sectionName(section)} (${section.type}) can't do that.`,
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
