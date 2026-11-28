import { describe, expect, it } from "vitest";

import { resolveSections, workbookTemplateSchema } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { BUILT_IN_SECTION_TYPES } from "./section-types";
import { createWorkbookContent, missingRequiredFields, renderPage } from "./create-workbook";
import { toolResultPayload } from "./pages-tools";

const coding = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.coding());
const types = (type: string) => BUILT_IN_SECTION_TYPES[type];

describe("createWorkbookContent", () => {
	it("copies the template into a new Project: the home page, the guide and the other pages", async () => {
		const pages = new FakePages();

		const created = await createWorkbookContent(pages, {
			template: coding,
			types,
			name: "Fix the server bug",
			values: { goal: "Fix the bug in the Kilo server", "context-and-links": "  " },
			description: "Workbook · Coding (coding)",
		});

		const project = pages.projects.get(created.projectId)!;
		expect(project).toMatchObject({
			title: "Fix the server bug",
			description: "Workbook · Coding (coding)",
		});
		expect(created.url).toBe(`https://pages.test/project/${created.projectId}`);
		const brief = pages.markdown(project.documentId);
		expect(brief).toMatch(
			/^## Goal\n\n_What should be true[^\n]*_\n\nFix the bug in the Kilo server\n\n## Where we left off\n\n_The latest handoff only:[^\n]*_\n\n- Nothing yet\.\n\n## Who's working on what\n\n_Who is working[^\n]*_\n\n- Nobody right now\.\n\n## Open questions\n\n_Things only the user can decide\._\n\n## Context and links/,
		);
		expect(brief).toContain("## Context and links\n\n_Where things are:");
		expect(brief).toContain("_Not given yet._");
		expect(brief).not.toContain("Seeded");
		expect(pages.pagesOf(created.projectId).map((page) => page.title)).toEqual([
			"How to work here",
			"Plan",
			"Follow-ups",
			"Decisions & findings",
			"Change Log",
		]);
		expect(pages.markdown(created.guidePageId)).toContain("Extract, don't archive");
		const [guide, plan, followUps, record, changeLog] = pages
			.pagesOf(created.projectId)
			.map((page) => page.id);
		expect(guide).toBe(created.guidePageId);
		expect(
			created.sections.map(({ id, type, pageId, heading }) => [id, type, pageId, heading]),
		).toEqual([
			["goal", "goal", undefined, "Goal"],
			["handoff", "handoff", undefined, "Where we left off"],
			["activity", "activity", undefined, "Who's working on what"],
			["questions", "questions", undefined, "Open questions"],
			["context-and-links", "notes", undefined, "Context and links"],
			["constraints-and-non-goals", "todo", undefined, "Constraints and non-goals"],
			["acceptance-criteria", "todo", undefined, "Acceptance criteria"],
			["plan", "plan", plan, undefined],
			["follow-ups", "todo", followUps, undefined],
			["decisions", "log", record, "Decisions"],
			["findings", "log", record, "Findings"],
			["change-log", "change-log", changeLog, undefined],
		]);
		expect(created.sections.find((section) => section.id === "plan")).toMatchObject({
			collects: expect.stringContaining("The work, in order"),
			instructions: expect.stringContaining("Each step ends in one commit"),
		});
		expect(pages.markdown(plan!)).toBe(
			[
				"_The work, in order, each step sized for one chat; the checkboxes under it are its tasks, and jobs only the user can do are marked (you)._",
				"",
				"- [ ] **1. Refine the Brief and draft this Plan**: the first chat's job.",
				"  - [ ] Fill in what the Brief is missing, asking the user",
				"  - [ ] Draft the steps, each with its tasks",
				"  - [ ] Confirm the Plan (you)",
			].join("\n"),
		);
		expect(pages.markdown(followUps!)).toMatch(/^_Out-of-scope work[^\n]*_$/);
		expect(pages.markdown(changeLog!)).toBe("_Every handoff, newest first._");
	});

	it("refuses a Brief without its required fields, before touching Pages", async () => {
		const pages = new FakePages();

		await expect(
			createWorkbookContent(pages, {
				template: coding,
				types,
				name: "x",
				values: { goal: " " },
				description: "Workbook · Coding (coding)",
			}),
		).rejects.toMatchObject({ code: "VALIDATION", message: "Fill in the Brief first: Goal." });
		expect(pages.calls).toEqual([]);
	});

	it("reports a Project Pages didn't create", async () => {
		const pages = { call: async () => ({}) };

		await expect(
			createWorkbookContent(pages, {
				template: coding,
				types,
				name: "x",
				values: { goal: "g" },
				description: "Workbook · Coding (coding)",
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});

	it("passes on a failing Pages call", async () => {
		const pages = new FakePages();
		pages.failOn = "create_page";

		await expect(
			createWorkbookContent(pages, {
				template: coding,
				types,
				name: "x",
				values: { goal: "g" },
				description: "Workbook · Coding (coding)",
			}),
		).rejects.toThrow("create_page failed");
	});
});

describe("renderPage and missingRequiredFields", () => {
	it("fills the wizard's answers and lists missing required fields", () => {
		const home = resolveSections(coding, types)[0]!.sections;
		expect(renderPage(coding, types, home, { goal: " Ship it " })).toContain(
			"_\n\nShip it\n\n## Where we left off",
		);
		expect(missingRequiredFields(coding, types, {})).toEqual(["Goal"]);
		expect(missingRequiredFields(coding, types, { goal: "g" })).toEqual([]);
	});
});

describe("toolResultPayload", () => {
	it("prefers structured content, then parses JSON text, then keeps plain text", () => {
		expect(toolResultPayload("t", { structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
		expect(toolResultPayload("t", { content: [{ type: "text", text: '{"b":2}' }] })).toEqual({
			b: 2,
		});
		expect(toolResultPayload("t", { content: [{ type: "text", text: "hello" }] })).toBe("hello");
		expect(toolResultPayload("t", { content: [] })).toBeUndefined();
		expect(toolResultPayload("t", undefined)).toBeUndefined();
	});

	it("turns an error result into a KernelError with the tool's message", () => {
		expect(() =>
			toolResultPayload("create_page", {
				isError: true,
				content: [{ type: "text", text: '{"error":"Unauthorized"}' }],
			}),
		).toThrow("Pages create_page failed: Unauthorized");
		expect(() =>
			toolResultPayload("x", { isError: true, content: [{ type: "text", text: "boom" }] }),
		).toThrow("Pages x failed: boom");
		expect(() => toolResultPayload("x", { isError: true })).toThrow("Pages x failed: no details");
	});
});
