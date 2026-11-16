import type { PagesToolCaller } from "../main/pages-tools";

interface FakeBlock {
	node_id: string;
	markdown: string;
}

interface FakePage {
	id: string;
	title: string;
	projectId: string;
	blocks: FakeBlock[];
	revision: number;
}

type Args = Readonly<Record<string, unknown>>;

/**
 * An in-memory stand-in for the Pages MCP tools kilo.workbooks calls, with the
 * same argument and result shapes (a Project's document is a page whose id is
 * its `document_id`). Each block holds markdown; `replace_match` and `set_node`
 * act on that markdown, which is enough to check what the workbook writes.
 */
export class FakePages implements PagesToolCaller {
	readonly calls: { tool: string; args: Args }[] = [];
	readonly pages = new Map<string, FakePage>();
	readonly projects = new Map<string, { documentId: string; title: string; description: string }>();
	failOn: string | null = null;
	#next = 0;

	async call(tool: string, args: Args): Promise<unknown> {
		this.calls.push({ tool, args });
		if (this.failOn === tool) throw new Error(`${tool} failed`);
		switch (tool) {
			case "create_project":
				return this.#createProject(args);
			case "create_page":
				return this.#createPage(args);
			case "read_page":
				return this.#readPage(args);
			case "edit_page":
				return this.#editPage(args);
			default:
				throw new Error(`FakePages doesn't know ${tool}`);
		}
	}

	/** A page's markdown, blocks joined. */
	markdown(pageId: string): string {
		return this.#page(pageId)
			.blocks.map((block) => block.markdown)
			.join("\n\n");
	}

	documentOf(projectId: string): string {
		return this.projects.get(projectId)!.documentId;
	}

	pagesOf(projectId: string): FakePage[] {
		const documentId = this.documentOf(projectId);
		return [...this.pages.values()].filter(
			(page) => page.projectId === projectId && page.id !== documentId,
		);
	}

	#id(prefix: string) {
		this.#next += 1;
		return `${prefix}-${this.#next}`;
	}

	#createProject(args: Args) {
		const projectId = this.#id("prj");
		const documentId = this.#id("doc");
		const description = String(args.description ?? "");
		this.projects.set(projectId, { documentId, title: String(args.title), description });
		this.pages.set(documentId, {
			id: documentId,
			title: String(args.title),
			projectId,
			blocks: [
				{ node_id: this.#id("n"), markdown: `${description}\n\n## Guidance\n\nSeeded.` },
				{ node_id: this.#id("n"), markdown: "Second seeded block." },
			],
			revision: 1,
		});
		return {
			project_id: projectId,
			document_id: documentId,
			url: `https://pages.test/project/${projectId}`,
		};
	}

	#createPage(args: Args) {
		const id = this.#id("page");
		this.pages.set(id, {
			id,
			title: String(args.title),
			projectId: String(args.project_id),
			blocks: this.#blocks(String(args.markdown ?? "")),
			revision: 1,
		});
		return { page_id: id, url: `https://pages.test/p/${id}` };
	}

	/** Splits markdown into blocks at blank lines, keeping fenced code together, as Pages does. */
	#blocks(markdown: string): FakeBlock[] {
		const parts: string[] = [];
		let fenced = false;
		for (const chunk of markdown.split("\n\n")) {
			if (fenced) parts[parts.length - 1] += `\n\n${chunk}`;
			else parts.push(chunk);
			if ((chunk.match(/```/g) ?? []).length % 2 === 1) fenced = !fenced;
		}
		return parts
			.filter((part) => part.trim())
			.map((part) => ({ node_id: this.#id("n"), markdown: part }));
	}

	#target(args: Args): FakePage {
		if (args.page_id) return this.#page(String(args.page_id));
		return this.#page(this.documentOf(String(args.project_id)));
	}

	#page(id: string): FakePage {
		const page = this.pages.get(id);
		if (!page) throw new Error(`no page ${id}`);
		return page;
	}

	#readPage(args: Args) {
		const page = this.#target(args);
		return {
			page_id: page.id,
			title: page.title,
			revision: `r${page.revision}`,
			blocks: page.blocks.map((block) => ({ ...block })),
		};
	}

	#editPage(args: Args) {
		const page = this.#target(args);
		const scope = args.conflict_scope;
		if (scope !== "target" && args.revision !== `r${page.revision}`) {
			throw new Error("stale_revision");
		}
		for (const operation of args.operations as Record<string, unknown>[]) {
			this.#apply(page, operation);
		}
		page.revision += 1;
		return { page_id: page.id, revision: `r${page.revision}` };
	}

	#apply(page: FakePage, operation: Record<string, unknown>) {
		const block = () => {
			const found = page.blocks.find((candidate) => candidate.node_id === operation.node_id);
			if (!found) throw new Error(`no block ${String(operation.node_id)}`);
			return found;
		};
		switch (operation.op) {
			case "replace_block_markdown":
				block().markdown = String(operation.markdown);
				return;
			case "delete_block":
				page.blocks = page.blocks.filter((candidate) => candidate.node_id !== operation.node_id);
				return;
			case "insert_markdown": {
				const added = this.#blocks(String(operation.markdown));
				const after = page.blocks.findIndex(
					(candidate) => candidate.node_id === operation.after_node_id,
				);
				page.blocks.splice(after === -1 ? page.blocks.length : after + 1, 0, ...added);
				return;
			}
			case "replace_match": {
				const target = block();
				const match = String(operation.match_text);
				if (target.markdown.split(match).length !== 2) throw new Error("invalid_edit_selector");
				const replacement = String(operation.replacement ?? operation.replacement_markdown);
				target.markdown = target.markdown.replace(match, replacement);
				return;
			}
			case "set_node": {
				const target = block();
				const match = String(operation.match_text);
				const attrs = operation.attrs as { checked?: boolean };
				target.markdown = target.markdown
					.split("\n")
					.map((line) =>
						line.includes(match) && attrs.checked !== undefined
							? line.replace(/^(\s*)- \[[ x]\]/, `$1- [${attrs.checked ? "x" : " "}]`)
							: line,
					)
					.join("\n");
				return;
			}
			default:
				throw new Error(`FakePages doesn't know op ${String(operation.op)}`);
		}
	}
}
