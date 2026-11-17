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

	it("matches the template's sections and guide by title, ignoring case and spacing", () => {
		const matched = matchSections(
			[page("How to work here", "g"), page(" plan ", "p"), page("Decisions", "d"), page("Mine")],
			templates,
			coding,
		);

		expect(matched).toEqual({
			guidePageId: "g",
			sections: [
				{ id: "plan", title: "Plan", itemType: "plan-step", pageId: "p" },
				{ id: "decisions", title: "Decisions", itemType: "decision", pageId: "d" },
			],
		});
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
			sections: [
				{ id: "plan", pageId: expect.any(String) },
				{ id: "tasks", pageId: expect.any(String) },
			],
		});
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
