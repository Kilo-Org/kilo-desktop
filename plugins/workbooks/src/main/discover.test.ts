import { describe, expect, it } from "vitest";

import {
	workbookTemplateSchema,
	type WorkbookSectionRef,
	type WorkbookTemplate,
} from "../contracts";
import { FakePages } from "../test/fake-pages";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { BUILT_IN_SECTION_TYPES } from "./section-types";
import { discoverWorkbooks, markerFor, matchSections, parseMarker } from "./discover";

const coding = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.coding());
const blank = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.blank());
const templates: WorkbookTemplate[] = [coding, blank];
const types = (type: string) => BUILT_IN_SECTION_TYPES[type];

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
	const summary = (sections: readonly WorkbookSectionRef[]) =>
		sections.map(({ id, type, pageId, heading }) => [id, type, pageId, heading]);

	it("finds each template page's sections, and a known template's home sections in the Brief", () => {
		const matched = matchSections(
			[
				page("How to work here", "g"),
				page(" plan ", "p"),
				page("Follow-ups", "u"),
				page("Decisions & Findings", "r"),
				page("Change Log", "c"),
				page("Mine"),
			],
			templates,
			coding,
			types,
		);

		expect(matched.guidePageId).toBe("g");
		expect(summary(matched.sections)).toEqual([
			["goal", "goal", undefined, "Goal"],
			["handoff", "handoff", undefined, "Where we left off"],
			["activity", "activity", undefined, "Who's working on what"],
			["questions", "questions", undefined, "Open questions"],
			["context-and-links", "notes", undefined, "Context and links"],
			["constraints-and-non-goals", "todo", undefined, "Constraints and non-goals"],
			["acceptance-criteria", "todo", undefined, "Acceptance criteria"],
			["plan", "plan", "p", undefined],
			["follow-ups", "todo", "u", undefined],
			["decisions", "log", "r", "Decisions"],
			["findings", "log", "r", "Findings"],
			["change-log", "change-log", "c", undefined],
		]);
	});

	it("leaves out the sections of pages it can't find", () => {
		const matched = matchSections([page("Plan", "p")], templates, coding, types);

		expect(matched.sections.map((section) => section.id)).toEqual([
			"goal",
			"handoff",
			"activity",
			"questions",
			"context-and-links",
			"constraints-and-non-goals",
			"acceptance-criteria",
			"plan",
		]);
	});

	it("falls back to every known template's pages when the template is unknown, without the Brief", () => {
		const matched = matchSections(
			[page("Decisions & findings", "r"), page("Notes", "n")],
			templates,
			undefined,
			types,
		);

		expect(matched.guidePageId).toBeUndefined();
		expect(matched.sections.map((section) => [section.id, section.pageId])).toEqual([
			["decisions", "r"],
			["findings", "r"],
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
			"Follow-ups",
		]);
		pages.addProject("Shopping list", "Groceries");
		const spike = pages.addProject("Spike", "Workbook · Spike · workspace: Kilo Desktop.", [
			"Decisions & findings",
		]);
		const older = pages.addProject("Scratch", "Workbook · Blank · workspace: W", ["Notes"]);

		const found = await discoverWorkbooks(pages, { templates: () => templates, types });

		expect(found.map((workbook) => workbook.id)).toEqual([made, spike, older]);
		expect(found[0]).toMatchObject({
			id: made,
			projectId: made,
			name: "Clock",
			templateId: "coding",
			url: `https://pages.test/project/${made}`,
			backend: { kind: "pages-mcp", server: "pages" },
		});
		expect(found[0]!.sections.slice(7)).toMatchObject([
			{ id: "plan", type: "plan" },
			{ id: "follow-ups", type: "todo" },
		]);
		expect(found[0]!.guidePageId).toEqual(expect.any(String));
		expect(Date.parse(found[0]!.createdAt)).not.toBeNaN();
		expect(found[1]).toMatchObject({ templateId: "spike", templateName: "Spike" });
		expect(found[1]!.sections.map((section) => section.id)).toEqual(["decisions", "findings"]);
		expect(found[2]).toMatchObject({ templateId: "blank" });
	});

	it("reuses what it already knows about a workbook instead of listing its pages", async () => {
		const pages = new FakePages();
		const projectId = pages.addProject("Clock", "Workbook · Coding (coding)", ["Plan"]);
		const known = {
			guidePageId: "guide",
			sections: [{ id: "plan", title: "Steps", type: "plan" as const, pageId: "p" }],
		};

		const [found] = await discoverWorkbooks(pages, {
			templates: () => templates,
			types,
			known: (id) => (id === projectId ? known : undefined),
		});

		expect(found).toMatchObject({ name: "Clock", ...known });
		expect(pages.calls.map((call) => call.tool)).toEqual(["list_projects"]);
	});
});
