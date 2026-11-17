import { afterEach, describe, expect, it } from "vitest";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import { SessionWorkbooks, Workbooks, type Workbook } from "../contracts";
import { bootWorkbooks } from "../test/hosts";
import { whereILeftOffEdits, withStatus } from "./workbook-writer";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const SESSION = "wses_1";

async function boot(options: { flag?: boolean } = {}) {
	const booted = await bootWorkbooks(options);
	hosts.push(booted.host);
	const { host, pages } = booted;
	const workbook = await host.invoke(Workbooks, "create", {
		workspaceId: "ws-1",
		templateId: "coding",
		name: "Fix the server bug",
		values: { goal: "Fix the bug" },
	});
	await host.invoke(SessionWorkbooks, "setActive", {
		workSessionId: SESSION,
		workbookId: workbook.id,
	});
	const tools = () => host.main.kernelSdk.extensions.list(Tool);
	const call = async (id: string, input: unknown, workSessionId: string | null = SESSION) => {
		await expect.poll(() => tools().some((tool) => tool.key === `kilo.workbooks/${id}`)).toBe(true);
		const tool = tools().find((candidate) => candidate.key === `kilo.workbooks/${id}`)!;
		const context: ToolCallContext = {
			workSessionId,
			workspaceId: "ws-1",
			chatId: "chat",
			callId: "call_1",
			external: false,
			signal: new AbortController().signal,
		};
		return tool.implementation!.run(tool.implementation!.input.parse(input), context) as Promise<
			Record<string, unknown>
		>;
	};
	const page = (section: string) =>
		pages.markdown(workbook.sections.find((candidate) => candidate.id === section)!.pageId);
	return { host, pages, workbook: workbook as Workbook, call, tools, page };
}

describe("workbook tools", () => {
	it("are agent tools behind the workbooks flag", async () => {
		const on = await boot();
		await expect
			.poll(() => on.tools().filter((tool) => tool.pluginId === "kilo.workbooks").length)
			.toBe(6);

		const off = await boot({ flag: false });
		expect(off.tools().filter((tool) => tool.pluginId === "kilo.workbooks")).toEqual([]);
	});

	it("read the session's workbook: the Brief, a section or the guide", async () => {
		const { call, workbook } = await boot();

		const brief = await call("read_workbook", {});
		expect(brief).toMatchObject({
			workbook: { id: workbook.id, name: "Fix the server bug" },
			showing: "brief",
		});
		expect(brief.markdown).toContain("Fix the bug");
		expect((brief.sections as unknown[]).length).toBe(10);
		expect((await call("read_workbook", { section: "plan" })).markdown).toContain("**1. Refine");
		expect((await call("read_workbook", { section: "guide" })).markdown).toContain(
			"Extract, don't archive",
		);
		await expect(call("read_workbook", { section: "nope" })).rejects.toThrow('no "nope" section');
	});

	it("add numbered plan steps and set their status, ticking done steps", async () => {
		const { call, page, pages, workbook } = await boot();

		await expect(
			call("add_plan_step", { title: "Build it", intent: "make it work" }),
		).resolves.toEqual({ section: "plan", step: 2 });
		// Pages keeps the template's Plan (intro, heading, list) as one block: the step joins its list.
		expect(page("plan")).toContain(
			"the user confirms before building.\n- [ ] **2. Build it**: make it work",
		);
		const plan = workbook.sections.find((section) => section.id === "plan")!;
		expect(pages.pages.get(plan.pageId)!.blocks).toHaveLength(1);
		await call("set_step_status", { step: "2", status: "in_progress" });
		expect(page("plan")).toContain("- [ ] **2. Build it**: make it work · in progress");

		await call("set_step_status", { step: "build it", status: "done", note: "shipped (abc123)" });
		expect(page("plan")).toContain("- [x] **2. Build it**: make it work · done: shipped (abc123)");

		await call("set_step_status", { step: "2", status: "todo" });
		expect(page("plan").split("\n")).toContain("- [ ] **2. Build it**: make it work");

		await call("set_step_status", { step: "2.", status: "blocked", note: "waiting on review" });
		expect(page("plan")).toContain("**2. Build it**: make it work · blocked: waiting on review");
		await expect(call("set_step_status", { step: "2", status: "blocked" })).rejects.toThrow(
			"Say what blocks it",
		);

		await expect(call("set_step_status", { step: "2", status: "done" })).rejects.toThrow(
			"Say what was done",
		);
		await expect(call("set_step_status", { step: "9", status: "in_progress" })).rejects.toThrow(
			'No plan step matches "9"',
		);
		await expect(call("set_step_status", { step: "**", status: "in_progress" })).rejects.toThrow(
			"use the step number",
		);
	});

	it("record decisions and file items in each section's format", async () => {
		const { call, page } = await boot();
		const date = new Date().toISOString().slice(0, 10);

		await call("record_decision", { decision: "Use SSE", why: "simpler", rejected: "websockets" });
		expect(page("decisions")).toContain(
			`- **Use SSE.** Why: simpler. Rejected: websockets. (${date})`,
		);

		await call("file_item", { section: "tasks", text: "Get an API key", detail: "user" });
		expect(page("tasks")).toContain("- [ ] Get an API key (user)");
		await call("file_item", {
			section: "findings",
			text: "The clock mock flakes",
			detail: "ran 50x",
		});
		expect(page("findings")).toContain(`- **The clock mock flakes.** Evidence: ran 50x. (${date})`);
		await call("file_item", { section: "questions", text: "Support Windows", detail: "CI cost" });
		expect(page("questions")).toContain("- **Support Windows?** CI cost");
		await call("file_item", { section: "artifacts", text: "pr: #12", detail: "the fix" });
		expect(page("artifacts")).toContain(`- pr: #12 · the fix (${date})`);
		await call("file_item", { section: "snippets", text: "Run e2e", detail: "pnpm e2e" });
		expect(page("snippets")).toContain("### Run e2e\n\n```\npnpm e2e\n```");
		await call("file_item", { section: "notes", text: "Remember lunch" });
		expect(page("notes")).toContain("Remember lunch");
		await call("file_item", { section: "follow-ups", text: "Later thing" });
		expect(page("follow-ups")).toContain("- [ ] Later thing");

		await expect(call("file_item", { section: "plan", text: "x" })).rejects.toThrow(
			"add_plan_step",
		);
		await expect(call("file_item", { section: "decisions", text: "x" })).rejects.toThrow(
			"record_decision",
		);
	});

	it("replace the Brief's Where I left off", async () => {
		const { call, pages, workbook } = await boot();

		await call("set_where_i_left_off", { text: "Step 2 done; next step 3." });

		const brief = pages.markdown(pages.documentOf(workbook.projectId));
		expect(brief).toMatch(
			/## Where I left off\n\n- \d{4}-\d{2}-\d{2}: Step 2 done; next step 3.\n\n## Goal/,
		);
		expect(brief).not.toContain("Nothing yet.");
	});

	it("need a workbook: the session's, or one named", async () => {
		const { call, workbook } = await boot();

		await expect(call("read_workbook", {}, null)).rejects.toThrow("This chat has no workbook");
		await expect(call("read_workbook", { workbookId: workbook.id }, null)).resolves.toMatchObject({
			showing: "brief",
		});
		await expect(
			call("read_workbook", { workbookId: workbook.projectId }, null),
		).resolves.toMatchObject({ workbook: { id: workbook.id } });
		await expect(call("read_workbook", { workbookId: "nope" }, null)).rejects.toThrow(
			'No workbook "nope"',
		);
	});

	it("retry once when another writer got there first", async () => {
		const { call, pages, page } = await boot();
		const original = pages.call.bind(pages);
		let raced = false;
		pages.call = async (tool, args) => {
			if (tool === "edit_page" && !raced) {
				raced = true;
				throw new Error("stale_revision");
			}
			return original(tool, args);
		};

		await call("file_item", { section: "tasks", text: "After a race" });

		expect(page("tasks")).toContain("- [ ] After a race");
	});
});

describe("workbooks missing a section", () => {
	it("say which sections there are", async () => {
		const { call, host, workbook } = await boot();
		const { id: _, createdAt: __, lastUsedAt: ___, usedIn: ____, ...reference } = workbook;
		const bare = await host.invoke(Workbooks, "add", {
			...reference,
			workspaceId: null,
			name: "Bare",
			sections: [{ id: "notes", title: "Notes", itemType: "note", pageId: workbook.guidePageId }],
		});

		await expect(
			call("add_plan_step", { title: "x", intent: "y", workbookId: bare.id }),
		).rejects.toThrow("no section for plan-steps");
		await expect(
			call("file_item", { section: "tasks", text: "x", workbookId: bare.id }),
		).rejects.toThrow("(it has: notes)");
	});
});

describe("withStatus and whereILeftOffEdits", () => {
	it("set a step's checkbox and suffix", () => {
		expect(withStatus("  - [x] **3. A** · done: x", "blocked", "waiting")).toBe(
			"  - [ ] **3. A** · blocked: waiting",
		);
	});

	it("handle a heading in its own block, an empty section and a Brief without one", () => {
		const entry = "- today: x";
		expect(
			whereILeftOffEdits(
				[
					{ node_id: "h", markdown: "## Where I left off" },
					{ node_id: "a", markdown: "_note_" },
					{ node_id: "b", markdown: "- old" },
					{ node_id: "g", markdown: "## Goal" },
				],
				entry,
			),
		).toEqual([
			{ op: "replace_block_markdown", node_id: "a", markdown: entry },
			{ op: "delete_block", node_id: "b" },
		]);
		expect(whereILeftOffEdits([{ node_id: "h", markdown: "## Where I left off" }], entry)).toEqual([
			{ op: "insert_markdown", after_node_id: "h", markdown: entry },
		]);
		expect(
			whereILeftOffEdits(
				[{ node_id: "b", markdown: "Intro\n\n## Where I left off\n\n- old" }],
				entry,
			),
		).toEqual([
			{
				op: "replace_block_markdown",
				node_id: "b",
				markdown: `Intro\n\n## Where I left off\n\n${entry}`,
			},
		]);
		expect(whereILeftOffEdits([{ node_id: "p", markdown: "Hi" }], entry)).toEqual([
			{ op: "insert_markdown", markdown: `## Where I left off\n\n${entry}` },
		]);
	});
});
