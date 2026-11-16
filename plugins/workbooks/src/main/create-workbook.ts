import { KernelError } from "@kilo-desktop/kernel";

import type { WorkbookSectionRef, WorkbookTemplate } from "../contracts";
import type { PagesToolCaller } from "./pages-tools";

export interface NewWorkbookContent {
	readonly template: WorkbookTemplate;
	readonly name: string;
	/** Brief field values by field id. */
	readonly values: Readonly<Record<string, string>>;
	/** Shown in the Project's description so workbooks are recognisable in Pages itself. */
	readonly workspaceLabel: string;
	readonly nonce?: () => string;
}

export interface CreatedWorkbookContent {
	readonly projectId: string;
	readonly url?: string;
	readonly guidePageId: string;
	readonly sections: WorkbookSectionRef[];
}

const NOT_GIVEN = "_Not given yet._";

/** The Brief's markdown: `{{field}}` placeholders filled from `values`, `{{status}}` as "New". */
export function renderBrief(
	template: WorkbookTemplate,
	values: Readonly<Record<string, string>>,
): string {
	return template.brief.markdown.replace(/\{\{([a-z][a-z0-9-]*)\}\}/g, (_, id: string) => {
		if (id === "status") return "New";
		return values[id]?.trim() || NOT_GIVEN;
	});
}

/** Required Brief fields left empty, by label. */
export function missingRequiredFields(
	template: WorkbookTemplate,
	values: Readonly<Record<string, string>>,
): string[] {
	return template.brief.fields
		.filter((field) => field.required && !values[field.id]?.trim())
		.map((field) => field.label);
}

/**
 * Copies a template into a new Pages Project, all at once: the Project, its
 * document replaced by the filled-in Brief, then the guide and every section
 * as Pages, in template order. A failure part-way leaves a partial Project in
 * Pages (reported to the caller); nothing is recorded in the workspace until
 * the whole copy succeeds.
 */
export async function createWorkbookContent(
	pages: PagesToolCaller,
	content: NewWorkbookContent,
): Promise<CreatedWorkbookContent> {
	const { template, name, values } = content;
	const missing = missingRequiredFields(template, values);
	if (missing.length > 0) {
		throw new KernelError("VALIDATION", `Fill in the Brief first: ${missing.join(", ")}.`);
	}
	const nonce = content.nonce ?? (() => globalThis.crypto.randomUUID().replaceAll("-", ""));

	const project = (await pages.call("create_project", {
		title: name,
		description: `Workbook · ${template.name} · workspace: ${content.workspaceLabel}`,
		nonce: nonce(),
	})) as { project_id?: string; url?: string };
	const projectId = project?.project_id;
	if (!projectId) throw new KernelError("UNAVAILABLE", "Pages didn't return the new Project.");

	await writeBrief(pages, projectId, renderBrief(template, values), nonce);

	const guide = await createPage(
		pages,
		projectId,
		template.guide.title,
		template.guide.markdown,
		nonce,
	);
	const sections: WorkbookSectionRef[] = [];
	for (const section of template.sections) {
		const pageId = await createPage(pages, projectId, section.title, section.markdown, nonce);
		sections.push({ id: section.id, title: section.title, itemType: section.itemType, pageId });
	}
	return { projectId, ...(project.url ? { url: project.url } : {}), guidePageId: guide, sections };
}

/** Replaces the Project document's seeded content with the Brief. */
async function writeBrief(
	pages: PagesToolCaller,
	projectId: string,
	markdown: string,
	nonce: () => string,
): Promise<void> {
	const document = (await pages.call("read_page", {
		project_id: projectId,
		comments: "none",
	})) as { revision?: string; blocks?: { node_id: string }[] };
	const [first, ...rest] = document?.blocks ?? [];
	if (!document?.revision || !first) {
		throw new KernelError("UNAVAILABLE", "Pages didn't return the new Project's document.");
	}
	await pages.call("edit_page", {
		project_id: projectId,
		revision: document.revision,
		nonce: nonce(),
		operations: [
			{ op: "replace_block_markdown", node_id: first.node_id, markdown },
			...rest.map((block) => ({ op: "delete_block", node_id: block.node_id })),
		],
	});
}

async function createPage(
	pages: PagesToolCaller,
	projectId: string,
	title: string,
	markdown: string,
	nonce: () => string,
): Promise<string> {
	const page = (await pages.call("create_page", {
		project_id: projectId,
		title,
		markdown,
		nonce: nonce(),
	})) as { page_id?: string };
	if (!page?.page_id) throw new KernelError("UNAVAILABLE", `Pages didn't create "${title}".`);
	return page.page_id;
}
