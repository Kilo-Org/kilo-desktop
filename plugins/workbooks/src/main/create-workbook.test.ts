import { describe, expect, it } from "vitest";

import { workbookTemplateSchema } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { createWorkbookContent, missingRequiredFields, renderBrief } from "./create-workbook";
import { toolResultPayload } from "./pages-tools";

const coding = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.coding());

describe("createWorkbookContent", () => {
	it("copies the template into a new Project: the Brief, the guide and its pages", async () => {
		const pages = new FakePages();

		const created = await createWorkbookContent(pages, {
			template: coding,
			name: "Fix the server bug",
			values: { goal: "Fix the bug in the Kilo server", context: "  " },
			description: "Workbook · Coding (coding)",
		});

		const project = pages.projects.get(created.projectId)!;
		expect(project).toMatchObject({
			title: "Fix the server bug",
			description: "Workbook · Coding (coding)",
		});
		expect(created.url).toBe(`https://pages.test/project/${created.projectId}`);
		const brief = pages.markdown(project.documentId);
		expect(brief).toContain("Fix the bug in the Kilo server");
		expect(brief).not.toContain("Status");
		expect(brief).toContain("## Context and links\n\n_Not given yet._");
		expect(brief).toContain("## Open questions");
		expect(brief).not.toContain("Seeded");
		expect(pages.pagesOf(created.projectId).map((page) => page.title)).toEqual([
			"How to work here",
			"Plan",
			"Decisions & findings",
		]);
		expect(pages.markdown(created.guidePageId)).toContain("Extract, don't archive");
		const [guide, plan, record] = pages.pagesOf(created.projectId).map((page) => page.id);
		expect(guide).toBe(created.guidePageId);
		expect(created.sections).toEqual([
			{ id: "plan", title: "Steps", itemType: "plan-step", pageId: plan, heading: "Steps" },
			{ id: "tasks", title: "Tasks", itemType: "task", pageId: plan, heading: "Tasks" },
			{
				id: "follow-ups",
				title: "Follow-ups",
				itemType: "task",
				pageId: plan,
				heading: "Follow-ups",
			},
			{
				id: "decisions",
				title: "Decisions",
				itemType: "decision",
				pageId: record,
				heading: "Decisions",
			},
			{
				id: "findings",
				title: "Findings",
				itemType: "finding",
				pageId: record,
				heading: "Findings",
			},
			{ id: "questions", title: "Open questions", itemType: "question", heading: "Open questions" },
		]);
		expect(pages.markdown(plan!)).toContain("Refine the Brief");
	});

	it("refuses a Brief without its required fields, before touching Pages", async () => {
		const pages = new FakePages();

		await expect(
			createWorkbookContent(pages, {
				template: coding,
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
				name: "x",
				values: { goal: "g" },
				description: "Workbook · Coding (coding)",
			}),
		).rejects.toThrow("create_page failed");
	});
});

describe("renderBrief and missingRequiredFields", () => {
	it("fills placeholders and lists missing required fields", () => {
		expect(renderBrief(coding, { goal: " Ship it " })).toContain("## Goal\n\nShip it");
		expect(missingRequiredFields(coding, {})).toEqual(["Goal"]);
		expect(missingRequiredFields(coding, { goal: "g" })).toEqual([]);
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
