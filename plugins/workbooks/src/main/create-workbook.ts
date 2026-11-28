import { KernelError } from "@kilo-desktop/kernel";

import {
	oneLine,
	resolveSections,
	templateQuestions,
	type ResolvedSection,
	type SectionTypeDefinition,
	type WorkbookSectionRef,
	type WorkbookTemplate,
} from "../contracts";
import type { PagesToolCaller } from "./pages-tools";

/** The title of every workbook's guide page. */
export const GUIDE_TITLE = "How to work here";

type Types = (type: string) => SectionTypeDefinition | undefined;

export interface NewWorkbookContent {
	readonly template: WorkbookTemplate;
	/** The section types on offer, by id. */
	readonly types: Types;
	readonly name: string;
	/** The wizard's answers, by the section each fills. */
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

/** Required wizard questions left empty, by label. */
export function missingRequiredFields(
	template: WorkbookTemplate,
	types: Types,
	values: Readonly<Record<string, string>>,
): string[] {
	return templateQuestions(template, types)
		.filter((field) => field.required && !values[field.id]?.trim())
		.map((field) => field.label);
}

/** A section as a workbook records it: its id, type, words, and where it lives. */
export function sectionRef(
	section: ResolvedSection,
	where: { pageId?: string },
): WorkbookSectionRef {
	return {
		id: section.id,
		type: section.type,
		title: section.title,
		collects: section.collects,
		...(section.instructions ? { instructions: section.instructions } : {}),
		...(where.pageId ? { pageId: where.pageId } : {}),
		...(section.heading ? { heading: section.heading } : {}),
	};
}

/**
 * A new page's markdown: each section's heading (none for a whole-page
 * section), the line saying what belongs there, and what it starts with: a
 * wizard answer, or what its section type starts with (the plan's first
 * step, the handoff's placeholder).
 */
export function renderPage(
	template: WorkbookTemplate,
	types: Types,
	sections: readonly ResolvedSection[],
	values: Readonly<Record<string, string>>,
): string {
	const asked = new Set(templateQuestions(template, types).map((field) => field.id));
	const parts: string[] = [];
	for (const section of sections) {
		if (section.heading) parts.push(`## ${section.heading}`);
		if (section.collects) parts.push(`_${oneLine(section.collects)}_`);
		if (asked.has(section.id)) parts.push(values[section.id]?.trim() || NOT_GIVEN);
		const starter = types(section.type)?.starter?.();
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
	const { template, types, name, values } = content;
	const missing = missingRequiredFields(template, types, values);
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

	const resolved = resolveSections(template, types);
	const home = resolved.find((entry) => entry.page.home)!;
	await writeHome(pages, projectId, renderPage(template, types, home.sections, values), nonce);
	const guide = await createPage(pages, projectId, GUIDE_TITLE, template.guide, nonce);

	const sections: WorkbookSectionRef[] = home.sections.map((section) => sectionRef(section, {}));
	for (const { page, sections: pageSections } of resolved) {
		if (page.home) continue;
		// One after another on purpose: Pages lists a Project's pages in the order they were made.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		const pageId = await createPage(
			pages,
			projectId,
			page.title,
			renderPage(template, types, pageSections, values),
			nonce,
		);
		sections.push(...pageSections.map((section) => sectionRef(section, { pageId })));
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
