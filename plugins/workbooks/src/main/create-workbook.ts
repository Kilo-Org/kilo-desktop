import { KernelError } from "@kilo-desktop/kernel";

import {
	type TemplatePage,
	type TemplateSection,
	type WorkbookSectionRef,
	type WorkbookTemplate,
} from "../contracts";
import { INSERT_IMPLEMENTATIONS } from "./inserts";
import { sectionNote } from "./inserts/helpers";
import type { PagesToolCaller } from "./pages-tools";

export interface NewWorkbookContent {
	readonly template: WorkbookTemplate;
	readonly name: string;
	/** Intake answers, by the section each fills. */
	readonly values: Readonly<Record<string, string>>;
	/** The Project's description: the workbook marker, which is how the app finds it again. */
	readonly description: string;
	readonly nonce?: () => string;
}

export interface CreatedWorkbookContent {
	readonly projectId: string;
	readonly url?: string;
	readonly guidePageId: string;
	readonly sections: WorkbookSectionRef[];
}

const NOT_GIVEN = "_Not given yet._";

/** Required intake fields left empty, by label. */
export function missingRequiredFields(
	template: WorkbookTemplate,
	values: Readonly<Record<string, string>>,
): string[] {
	return template.intake
		.filter((field) => field.required && !values[field.fills]?.trim())
		.map((field) => field.label);
}

/** A section as a workbook records it: its type resolved, its rules copied, where it is. */
export function sectionRef(
	section: TemplateSection,
	where: { pageId?: string },
): WorkbookSectionRef {
	const { starter: _, ...rest } = section;
	return {
		...rest,
		...(where.pageId ? { pageId: where.pageId } : {}),
		...(section.title ? { heading: section.title } : {}),
	};
}

/**
 * A new page's markdown: its intro, then each section's heading (none for a
 * whole-page section), the line saying what belongs there, and what it starts
 * with: an intake answer, or what its insert starts with (a plan's starter steps, the handoff's placeholder).
 */
export function renderPage(
	template: WorkbookTemplate,
	page: TemplatePage,
	values: Readonly<Record<string, string>>,
): string {
	const parts: string[] = page.intro?.trim() ? [page.intro.trim()] : [];
	const filled = new Set(template.intake.map((field) => field.fills));
	for (const section of page.sections) {
		if (section.title) parts.push(`## ${section.title}`);
		const note = sectionNote(section);
		if (note) parts.push(note);
		if (filled.has(section.id)) parts.push(values[section.id]?.trim() || NOT_GIVEN);
		const starter = INSERT_IMPLEMENTATIONS[section.type].starter?.(section);
		if (starter) parts.push(starter);
	}
	return parts.join("\n\n");
}

/**
 * Copies a template into a new Pages Project, all at once: the Project, its
 * document replaced by the home page, then the guide and the other pages, in
 * template order. A failure part-way leaves a partial Project in Pages
 * (reported to the caller); nothing is recorded until the whole copy
 * succeeds.
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
		description: content.description,
		nonce: nonce(),
	})) as { project_id?: string; url?: string };
	const projectId = project?.project_id;
	if (!projectId) throw new KernelError("UNAVAILABLE", "Pages didn't return the new Project.");

	const home = template.pages.find((page) => page.home)!;
	await writeHome(pages, projectId, renderPage(template, home, values), nonce);
	const guide = await createPage(
		pages,
		projectId,
		template.guide.title,
		template.guide.markdown,
		nonce,
	);

	const sections: WorkbookSectionRef[] = home.sections.map((section) => sectionRef(section, {}));
	for (const page of template.pages) {
		if (page.home) continue;
		// One after another on purpose: Pages lists a Project's pages in the order they were made.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		const pageId = await createPage(
			pages,
			projectId,
			page.title,
			renderPage(template, page, values),
			nonce,
		);
		sections.push(...page.sections.map((section) => sectionRef(section, { pageId })));
	}
	return { projectId, ...(project.url ? { url: project.url } : {}), guidePageId: guide, sections };
}

/** Replaces the Project document's seeded content with the home page. */
async function writeHome(
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
