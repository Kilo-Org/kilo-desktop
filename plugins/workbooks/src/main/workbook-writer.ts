import { KernelError } from "@kilo-desktop/kernel";

import type { Workbook, WorkbookSectionRef } from "../contracts";
import type { PagesToolCaller } from "./pages-tools";

interface Block {
	readonly node_id: string;
	readonly markdown?: string;
}

interface ReadPage {
	readonly revision: string;
	readonly blocks: readonly Block[];
}

export const STEP_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

const TASK_LINE = /^(\s*)- \[([ xX])\] (.*)$/;
const STATUS_SUFFIX = / · (in progress|blocked:.*|done:.*)$/;
const STEP_NUMBER = /^\*\*(\d+)\./;

/**
 * Writes workbook items into Pages in the formats the guide defines, so agents
 * never hand-edit them. Every write reads the page first and sends its
 * revision; a write that loses a race with another writer is retried once on
 * the fresh page, which is enough for concurrent agents appending items.
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

	sectionFor(itemType: WorkbookSectionRef["itemType"]): WorkbookSectionRef {
		const section = this.workbook.sections.find((candidate) => candidate.itemType === itemType);
		if (!section)
			throw new KernelError("NOT_FOUND", `This workbook has no section for ${itemType}s.`);
		return section;
	}

	async read(target: { pageId?: string }): Promise<string> {
		const page = await this.#read(target);
		return page.blocks
			.map((block) => block.markdown ?? "")
			.join("\n\n")
			.trim();
	}

	/** Adds a plan step, numbered after the last one. Returns its number. */
	async addPlanStep(title: string, intent: string): Promise<number> {
		const plan = this.sectionFor("plan-step");
		let number = 0;
		await this.#appendListItem(plan.pageId, (lines) => {
			number = Math.max(0, ...lines.map(stepNumber)) + 1;
			return `- [ ] **${number}. ${oneLine(title)}**: ${oneLine(intent)}`;
		});
		return number;
	}

	/** Sets a plan step's status: its checkbox and its ` · status` suffix together. Returns the step's line. */
	async setStepStatus(step: string, status: StepStatus, note?: string): Promise<string> {
		if ((status === "blocked" || status === "done") && !note?.trim()) {
			throw new KernelError(
				"VALIDATION",
				status === "done"
					? "Say what was done (and link the commit or PR)."
					: "Say what blocks it.",
			);
		}
		const plan = this.sectionFor("plan-step");
		return this.#withRetry(async () => {
			const page = await this.#read({ pageId: plan.pageId });
			const matches: { block: Block; index: number }[] = [];
			for (const block of page.blocks) {
				(block.markdown ?? "").split("\n").forEach((line, index) => {
					if (TASK_LINE.test(line) && matchesStep(line, step)) matches.push({ block, index });
				});
			}
			if (matches.length !== 1) {
				throw new KernelError(
					matches.length === 0 ? "NOT_FOUND" : "VALIDATION",
					matches.length === 0
						? `No plan step matches "${step}".`
						: `"${step}" matches ${matches.length} plan steps; use the step number.`,
				);
			}
			const { block, index } = matches[0]!;
			const lines = (block.markdown ?? "").split("\n");
			const updated = withStatus(lines[index]!, status, note);
			lines[index] = updated;
			await this.#edit({ pageId: plan.pageId }, page.revision, [
				{ op: "replace_block_markdown", node_id: block.node_id, markdown: lines.join("\n") },
			]);
			return updated;
		});
	}

	async recordDecision(decision: string, why: string, rejected?: string): Promise<string> {
		const rejectedText = rejected?.trim() ? ` Rejected: ${oneLine(rejected)}.` : "";
		const line = `- **${sentence(decision)}** Why: ${oneLine(why)}.${rejectedText} (${this.today()})`;
		await this.#appendListItem(this.sectionFor("decision").pageId, () => line);
		return line;
	}

	/** Files an item in a section, formatted for the section's item type. Returns what was written. */
	async fileItem(sectionId: string, text: string, detail?: string): Promise<string> {
		const section = this.section(sectionId);
		const extra = detail?.trim();
		switch (section.itemType) {
			case "plan-step":
				throw new KernelError("VALIDATION", "Use add_plan_step for plan steps.");
			case "decision":
				throw new KernelError("VALIDATION", "Use record_decision for decisions.");
			case "task": {
				const line = `- [ ] ${oneLine(text)}${extra ? ` (${oneLine(extra)})` : ""}`;
				await this.#appendListItem(section.pageId, () => line);
				return line;
			}
			case "finding": {
				const evidence = extra ? ` Evidence: ${oneLine(extra)}.` : "";
				const line = `- **${sentence(text)}**${evidence} (${this.today()})`;
				await this.#appendListItem(section.pageId, () => line);
				return line;
			}
			case "question": {
				const question = oneLine(text).replace(/[?.]*$/, "?");
				const line = `- **${question}**${extra ? ` ${oneLine(extra)}` : ""}`;
				await this.#appendListItem(section.pageId, () => line);
				return line;
			}
			case "artifact": {
				const line = `- ${oneLine(text)}${extra ? ` · ${oneLine(extra)}` : ""} (${this.today()})`;
				await this.#appendListItem(section.pageId, () => line);
				return line;
			}
			case "reference": {
				const markdown = `### ${oneLine(text)}\n\n\`\`\`\n${extra ?? ""}\n\`\`\``;
				await this.#appendBlock(section.pageId, markdown);
				return markdown;
			}
			case "note": {
				const markdown = extra ? `${text.trim()}\n\n${extra}` : text.trim();
				await this.#appendBlock(section.pageId, markdown);
				return markdown;
			}
		}
	}

	/** Replaces the Brief's "Where I left off" with a dated line. */
	async setWhereILeftOff(text: string): Promise<string> {
		const entry = `- ${this.today()}: ${oneLine(text)}`;
		await this.#withRetry(async () => {
			const page = await this.#read({});
			const operations = whereILeftOffEdits(page.blocks, entry);
			await this.#edit({}, page.revision, operations);
		});
		return entry;
	}

	async #appendListItem(pageId: string, line: (existingLines: string[]) => string): Promise<void> {
		await this.#withRetry(async () => {
			const page = await this.#read({ pageId });
			const lists = page.blocks.filter((block) => /^\s*- /.test(block.markdown ?? ""));
			const existing = lists.flatMap((block) => (block.markdown ?? "").split("\n"));
			const last = lists.at(-1);
			const item = line(existing);
			await this.#edit(
				{ pageId },
				page.revision,
				last
					? [
							{
								op: "replace_block_markdown",
								node_id: last.node_id,
								markdown: `${last.markdown}\n${item}`,
							},
						]
					: [{ op: "insert_markdown", markdown: item }],
			);
		});
	}

	async #appendBlock(pageId: string, markdown: string): Promise<void> {
		await this.#withRetry(async () => {
			const page = await this.#read({ pageId });
			await this.#edit({ pageId }, page.revision, [{ op: "insert_markdown", markdown }]);
		});
	}

	#target(target: { pageId?: string }) {
		return target.pageId ? { page_id: target.pageId } : { project_id: this.workbook.projectId };
	}

	async #read(target: { pageId?: string }): Promise<ReadPage> {
		const page = (await this.pages.call("read_page", {
			...this.#target(target),
			comments: "none",
		})) as Partial<ReadPage> | undefined;
		if (!page?.revision) throw new KernelError("UNAVAILABLE", "Pages didn't return the page.");
		return { revision: page.revision, blocks: page.blocks ?? [] };
	}

	async #edit(target: { pageId?: string }, revision: string, operations: unknown[]): Promise<void> {
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

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Text ending in one full stop (or its own ? or !), for bold item leads. */
function sentence(text: string): string {
	const trimmed = oneLine(text);
	return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stepNumber(line: string): number {
	const match = TASK_LINE.exec(line);
	const number = match ? STEP_NUMBER.exec(match[3]!) : null;
	return number ? Number(number[1]) : 0;
}

function matchesStep(line: string, step: string): boolean {
	const wanted = step.trim().replace(/\.$/, "");
	if (/^\d+$/.test(wanted)) return stepNumber(line) === Number(wanted);
	return line.toLowerCase().includes(wanted.toLowerCase());
}

/** A task line with its checkbox and ` · status` suffix set for `status`. */
export function withStatus(line: string, status: StepStatus, note?: string): string {
	const [, indent = "", , rest = ""] = TASK_LINE.exec(line) ?? [];
	const body = rest.replace(STATUS_SUFFIX, "");
	const text = note ? oneLine(note) : "";
	switch (status) {
		case "todo":
			return `${indent}- [ ] ${body}`;
		case "in_progress":
			return `${indent}- [ ] ${body} · in progress`;
		case "blocked":
			return `${indent}- [ ] ${body} · blocked: ${text}`;
		case "done":
			return `${indent}- [x] ${body} · done: ${text}`;
	}
}

/**
 * The edits that replace what follows the Brief's "Where I left off" heading
 * (up to the next heading) with `entry`, whether Pages keeps the heading in
 * its own block or in one block with the content; adds the section at the end
 * when the Brief has none.
 */
export function whereILeftOffEdits(blocks: readonly Block[], entry: string): unknown[] {
	const heading = /^## Where I left off\s*$/m;
	const at = blocks.findIndex((block) => heading.test(block.markdown ?? ""));
	if (at === -1) {
		return [{ op: "insert_markdown", markdown: `## Where I left off\n\n${entry}` }];
	}
	const block = blocks[at]!;
	const markdown = block.markdown ?? "";
	const start = markdown.search(heading);
	const afterHeading = markdown.indexOf("\n", start);
	const inBlock = afterHeading === -1 ? "" : markdown.slice(afterHeading);
	if (inBlock.trim()) {
		const next = inBlock.search(/\n#{1,6} /);
		const tail = next === -1 ? "" : inBlock.slice(next);
		const head = markdown.slice(0, afterHeading === -1 ? markdown.length : afterHeading);
		return [
			{
				op: "replace_block_markdown",
				node_id: block.node_id,
				markdown: `${head}\n\n${entry}${tail ? `\n${tail}` : ""}`,
			},
		];
	}
	const following: Block[] = [];
	for (const candidate of blocks.slice(at + 1)) {
		if (/^#{1,6} /.test(candidate.markdown ?? "")) break;
		following.push(candidate);
	}
	if (following.length === 0) {
		return [{ op: "insert_markdown", after_node_id: block.node_id, markdown: entry }];
	}
	const [first, ...rest] = following;
	return [
		{ op: "replace_block_markdown", node_id: first!.node_id, markdown: entry },
		...rest.map((candidate) => ({ op: "delete_block", node_id: candidate.node_id })),
	];
}
