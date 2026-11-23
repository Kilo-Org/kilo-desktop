import {
	DEFAULT_PAGES_MCP_SERVER,
	type Workbook,
	type WorkbookSectionRef,
	type WorkbookTemplate,
} from "../contracts";
import { sectionRef } from "./create-workbook";
import type { PagesToolCaller } from "./pages-tools";

/**
 * How a Pages Project is known to be a workbook: its description starts with
 * the marker, naming its template (and, since step 23, the template's id).
 * Older workbooks carry only the template's name, and some a workspace label
 * or a sentence after it.
 */
const MARKER = /^Workbook · (.+?)(?: \(([a-z][a-z0-9-]*)\))?(?= · |\. |\.$|$)/;

/** The description a new workbook's Project starts with. */
export function markerFor(template: Pick<WorkbookTemplate, "id" | "name">): string {
	return `Workbook · ${template.name} (${template.id})`;
}

export function parseMarker(
	description: string,
): { templateName: string; templateId?: string } | undefined {
	const match = MARKER.exec(description);
	if (!match) return undefined;
	const [, templateName, templateId] = match;
	return { templateName: templateName!, ...(templateId ? { templateId } : {}) };
}

const normalized = (title: string) => title.trim().toLowerCase();

const DEFAULT_GUIDE_TITLE = "How to work here";

/**
 * A workbook's guide and sections, found among its Project's pages by title:
 * the template's when it's known, otherwise any known template's (the first
 * to name a section wins). Each template page found brings its sections (the
 * part under each section's heading, or the whole page); a known template's
 * home sections are in the Brief. Pages that match nothing are left alone.
 */
export function matchSections(
	pages: readonly { page_id: string; title: string }[],
	templates: readonly WorkbookTemplate[],
	template: WorkbookTemplate | undefined,
): { guidePageId?: string; sections: WorkbookSectionRef[] } {
	const sources = template ? [template] : templates;
	const pageByTitle = new Map<string, string>();
	for (const page of pages) {
		if (!pageByTitle.has(normalized(page.title)))
			pageByTitle.set(normalized(page.title), page.page_id);
	}
	const guideTitles = new Set([
		...sources.map((source) => normalized(source.guide.title)),
		normalized(DEFAULT_GUIDE_TITLE),
	]);
	const guidePageId = [...guideTitles].map((title) => pageByTitle.get(title)).find(Boolean);

	const sections: WorkbookSectionRef[] = [];
	const taken = new Set<string>();
	for (const source of sources) {
		for (const page of source.pages) {
			const pageId = page.home ? undefined : pageByTitle.get(normalized(page.title));
			if (page.home ? !template : !pageId) continue;
			for (const section of page.sections) {
				if (taken.has(section.id)) continue;
				taken.add(section.id);
				sections.push(sectionRef(section, pageId ? { pageId } : {}));
			}
		}
	}
	return { ...(guidePageId ? { guidePageId } : {}), sections };
}

/** A workbook as found in Pages: everything but where and when the person used it. */
export type DiscoveredWorkbook = Omit<Workbook, "lastUsedAt" | "usedIn">;

export interface DiscoverDeps {
	readonly templates: () => readonly WorkbookTemplate[];
	/** What's already known of a workbook's pages, so they needn't be listed again. */
	readonly known?: (projectId: string) => Pick<Workbook, "guidePageId" | "sections"> | undefined;
}

interface ListedProject {
	project_id: string;
	title: string;
	description?: string;
	created_at?: string;
	url?: string;
}

/**
 * Every workbook the person can open in Pages: the marked Projects, with
 * their template (by the marker's id, else its name) and sections. A template
 * no longer on offer keeps the marker's name as its id, so the workbook still
 * shows and its sections still match.
 */
export async function discoverWorkbooks(
	pages: PagesToolCaller,
	deps: DiscoverDeps,
): Promise<DiscoveredWorkbook[]> {
	const templates = deps.templates();
	const byId = new Map(templates.map((template) => [template.id, template]));
	const byName = new Map(templates.map((template) => [normalized(template.name), template]));
	const projects = await listAll<ListedProject>(pages, "list_projects", "projects", {});
	const marked = projects.flatMap((project) => {
		const marker = parseMarker(project.description ?? "");
		return marker ? [{ project, marker }] : [];
	});
	// Each workbook's pages are listed at once, not one workbook after another.
	return Promise.all(
		marked.map(async ({ project, marker }): Promise<DiscoveredWorkbook> => {
			const template =
				(marker.templateId ? byId.get(marker.templateId) : undefined) ??
				byName.get(normalized(marker.templateName));
			const parts =
				deps.known?.(project.project_id) ??
				matchSections(
					await listAll<{ page_id: string; title: string }>(pages, "list_pages", "pages", {
						project_id: project.project_id,
					}),
					templates,
					template,
				);
			return {
				id: project.project_id,
				projectId: project.project_id,
				name: project.title,
				templateId: template?.id ?? marker.templateId ?? slug(marker.templateName),
				...(template ? {} : { templateName: marker.templateName }),
				backend: { kind: "pages-mcp", server: DEFAULT_PAGES_MCP_SERVER },
				...(project.url ? { url: project.url } : {}),
				...(parts.guidePageId ? { guidePageId: parts.guidePageId } : {}),
				sections: parts.sections,
				createdAt: project.created_at ?? new Date(0).toISOString(),
			};
		}),
	);
}

function slug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Every entry of a paged Pages list, following `next_cursor` to the end. */
async function listAll<T>(
	pages: PagesToolCaller,
	tool: string,
	key: string,
	args: Readonly<Record<string, unknown>>,
): Promise<T[]> {
	const entries: T[] = [];
	let cursor: string | null = null;
	do {
		const result = (await pages.call(tool, {
			...args,
			limit: 100,
			...(cursor ? { cursor } : {}),
		})) as Record<string, unknown> & { next_cursor?: string | null };
		entries.push(...((result?.[key] as T[] | undefined) ?? []));
		cursor = result?.next_cursor ?? null;
	} while (cursor);
	return entries;
}
