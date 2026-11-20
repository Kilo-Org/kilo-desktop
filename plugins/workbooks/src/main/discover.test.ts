import { describe, expect, it } from "vitest";

import { workbookTemplateSchema, type WorkbookTemplate } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { discoverWorkbooks, markerFor, matchSections, parseMarker } from "./discover";

const coding = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.coding());
const blank = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.blank());
const templates: WorkbookTemplate[] = [coding, blank];

describe("the workbook marker", () => {
	it("names the template and its id", () => {
		expect(markerFor(coding)).toBe("Workbook · Coding (coding)");
		expect(parseMarker(markerFor(coding))).toEqual({
			templateName: "Coding",
			templateId: "coding",
		});
	});

	it("reads markers written before they carried the template id", () => {
		expect(parseMarker("Workbook · Coding · workspace: Kilo Desktop")).toEqual({
			templateName: "Coding",
		});
		expect(
			parseMarker("Workbook · Spike · workspace: Kilo Desktop. Design spike for workbooks."),
		).toEqual({ templateName: "Spike" });
		expect(parseMarker("Workbook · Blank")).toEqual({ templateName: "Blank" });
	});

	it("isn't found in other descriptions", () => {
		expect(parseMarker("My notes")).toBeUndefined();
		expect(parseMarker("A Workbook · Coding")).toBeUndefined();
		expect(parseMarker("")).toBeUndefined();
	});
});

describe("matchSections", () => {
	const page = (title: string, id = title.toLowerCase()) => ({ page_id: id, title });

	it("finds sections under their headings on shared pages, and in the Brief", () => {
		const matched = matchSections(
			[
				page("How to work here", "g"),
				page(" plan ", "p"),
				page("Decisions & Findings", "r"),
				page("Mine"),
			],
			templates,
			coding,
		);

		expect(matched).toEqual({
			guidePageId: "g",
			sections: [
				{ id: "plan", title: "Steps", itemType: "plan-step", pageId: "p", heading: "Steps" },
				{ id: "tasks", title: "Tasks", itemType: "task", pageId: "p", heading: "Tasks" },
				{
					id: "follow-ups",
					title: "Follow-ups",
					itemType: "task",
					pageId: "p",
					heading: "Follow-ups",
				},
				{
					id: "decisions",
					title: "Decisions",
					itemType: "decision",
					pageId: "r",
					heading: "Decisions",
				},
				{
					id: "findings",
					title: "Findings",
					itemType: "finding",
					pageId: "r",
					heading: "Findings",
				},
				{
					id: "questions",
					title: "Open questions",
					itemType: "question",
					heading: "Open questions",
				},
			],
		});
	});

	it("keeps an older workbook's sections on their own pages", () => {
		const matched = matchSections(
			[
				page("Plan", "p"),
				page("Tasks", "t"),
				page("Decisions", "d"),
				page("Findings", "f"),
				page("Open questions", "q"),
				page("Follow-ups", "u"),
				page("Snippets", "s"),
			],
			templates,
			coding,
		);

		expect(
			matched.sections.map((section) => [section.id, section.pageId, section.heading]),
		).toEqual([
			["plan", "p", "Steps"],
			["tasks", "t", undefined],
			["follow-ups", "u", undefined],
			["decisions", "d", undefined],
			["findings", "f", undefined],
			["questions", "q", undefined],
		]);
	});

	it("falls back to every known template's sections when the template is unknown", () => {
		const matched = matchSections(
			[page("Findings", "f"), page("Notes", "n"), page("Open questions", "q")],
			templates,
			undefined,
		);

		expect(matched.guidePageId).toBeUndefined();
		expect(matched.sections.map((section) => [section.id, section.pageId])).toEqual([
			["findings", "f"],
			["questions", "q"],
			["notes", "n"],
		]);
		expect(matched.sections.some((section) => !section.pageId)).toBe(false);
	});
});

describe("discoverWorkbooks", () => {
	it("finds every marked Project across list pages, with its template and sections", async () => {
		const pages = new FakePages();
		pages.pageSize = 2;
		const made = pages.addProject("Clock", "Workbook · Coding (coding)", [
			"How to work here",
			"Plan",
			"Tasks",
		]);
		pages.addProject("Shopping list", "Groceries");
		const spike = pages.addProject("Spike", "Workbook · Spike · workspace: Kilo Desktop.", [
			"Decisions",
		]);
		const older = pages.addProject("Scratch", "Workbook · Blank · workspace: W", ["Notes"]);

		const found = await discoverWorkbooks(pages, { templates: () => templates });

		expect(found.map((workbook) => workbook.id)).toEqual([made, spike, older]);
		expect(found[0]).toMatchObject({
			id: made,
			projectId: made,
			name: "Clock",
			templateId: "coding",
			url: `https://pages.test/project/${made}`,
			backend: { kind: "pages-mcp", server: "pages" },
		});
		expect(found[0]!.sections.slice(0, 2)).toMatchObject([
			{ id: "plan", heading: "Steps" },
			{ id: "tasks", pageId: expect.any(String) },
		]);
		expect(found[0]!.guidePageId).toEqual(expect.any(String));
		expect(Date.parse(found[0]!.createdAt)).not.toBeNaN();
		expect(found[1]).toMatchObject({ templateId: "spike", templateName: "Spike" });
		expect(found[1]!.sections.map((section) => section.id)).toEqual(["decisions"]);
		expect(found[2]).toMatchObject({ templateId: "blank" });
	});

	it("reuses what it already knows about a workbook instead of listing its pages", async () => {
		const pages = new FakePages();
		const projectId = pages.addProject("Clock", "Workbook · Coding (coding)", ["Plan"]);
		const known = {
			guidePageId: "guide",
			sections: [{ id: "plan", title: "Plan", itemType: "plan-step" as const, pageId: "p" }],
		};

		const [found] = await discoverWorkbooks(pages, {
			templates: () => templates,
			known: (id) => (id === projectId ? known : undefined),
		});

		expect(found).toMatchObject({ name: "Clock", ...known });
		expect(pages.calls.map((call) => call.tool)).toEqual(["list_projects"]);
	});
});
