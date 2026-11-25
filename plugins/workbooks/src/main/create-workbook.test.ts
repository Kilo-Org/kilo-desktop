import { describe, expect, it } from "vitest";

import { workbookTemplateSchema } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { createWorkbookContent, missingRequiredFields, renderPage } from "./create-workbook";
import { toolResultPayload } from "./pages-tools";

const coding = workbookTemplateSchema.parse(BUILT_IN_TEMPLATES.coding());

describe("createWorkbookContent", () => {
	it("copies the template into a new Project: the home page, the guide and the other pages", async () => {
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
		expect(brief).toMatch(
			/^## Goal\n\n_What should be true[^\n]*_\n\nFix the bug in the Kilo server\n\n## Where we left off\n\n_The latest change only;[^\n]*_\n\n- Nothing yet\.\n\n## Who's working on what\n\n_Kept up to date by the workbook tools\._\n\n- Nobody right now\.\n\n## Open questions/,
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
			["context", "notes", undefined, "Context and links"],
			["constraints", "todo", undefined, "Constraints and non-goals"],
			["criteria", "todo", undefined, "Acceptance criteria"],
			["plan", "plan", plan, "Steps"],
			["follow-ups", "todo", followUps, undefined],
			["decisions", "log", record, "Decisions"],
			["findings", "log", record, "Findings"],
			["change-log", "log", changeLog, undefined],
		]);
		expect(created.sections.find((section) => section.id === "questions")).toMatchObject({
			answersTo: "decisions",
		});
		expect(created.sections.find((section) => section.id === "plan")).toMatchObject({
			requires: ["tasks-ticked", "link-or-reason"],
			instructions: expect.stringContaining("Each step ends in one commit"),
		});
		expect(created.sections.find((section) => section.id === "handoff")).toMatchObject({
			history: "change-log",
		});
		expect(pages.markdown(plan!)).toBe(
			[
				"## Steps",
				"",
				"_The work, in order, each step sized for one chat; the checkboxes under it are its tasks: chores, review comments, and jobs only the user can do, marked (you)._",
				"",
				"- [ ] **1. Refine the Brief and draft this Plan**: the first agent's job.",
				"  - [ ] Propose acceptance criteria and constraints in the Brief",
				"  - [ ] Draft the steps, each with its tasks",
				"  - [ ] Confirm the Plan (you)",
			].join("\n"),
		);
		expect(pages.markdown(followUps!)).toMatch(/^_Out-of-scope work[^\n]*_$/);
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

describe("renderPage and missingRequiredFields", () => {
	it("fills intake answers and lists missing required fields", () => {
		const home = coding.pages.find((page) => page.home)!;
		expect(renderPage(coding, home, { goal: " Ship it " })).toContain(
			"_\n\nShip it\n\n## Where we left off",
		);
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
