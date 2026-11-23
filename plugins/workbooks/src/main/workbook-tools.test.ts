import { afterEach, describe, expect, it } from "vitest";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import { SessionWorkbooks, Workbooks, type Workbook } from "../contracts";
import { bootWorkbooks } from "../test/hosts";
import { withStatus } from "./items";
import { sectionMarkdown } from "./section-scope";
import { replaceBodyEdits } from "./workbook-writer";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const SESSION = "wses_1";
const today = () => new Date().toISOString().slice(0, 10);

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
	/** A section's markdown: its page, or the part under its heading. */
	const section = (id: string) => {
		const ref = workbook.sections.find((candidate) => candidate.id === id)!;
		const markdown = pages.markdown(ref.pageId ?? pages.documentOf(workbook.projectId));
		return sectionMarkdown(markdown, ref.heading);
	};
	const brief = () => pages.markdown(pages.documentOf(workbook.projectId));
	return { host, pages, workbook: workbook as Workbook, call, tools, section, brief };
}

describe("workbook tools", () => {
	it("are agent tools behind the workbooks flag", async () => {
		const on = await boot();
		await expect
			.poll(() => on.tools().filter((tool) => tool.pluginId === "kilo.workbooks").length)
			.toBe(12);

		const off = await boot({ flag: false });
		expect(off.tools().filter((tool) => tool.pluginId === "kilo.workbooks")).toEqual([]);
	});

	it("read the session's workbook: its sections, the Brief, a section or the guide", async () => {
		const { call, workbook } = await boot();

		const brief = await call("read_workbook", {});
		expect(brief).toMatchObject({
			workbook: { id: workbook.id, name: "Fix the server bug" },
			showing: "brief",
		});
		expect(brief.markdown).toMatch(/^## Goal\n\n_[^\n]*_\n\nFix the bug\n\n## Where we left off/);
		const sections = brief.sections as {
			id: string;
			type: string;
			role?: string;
			collects?: string;
		}[];
		expect(sections.map((entry) => [entry.id, entry.type, entry.role])).toEqual([
			["goal", "text", "goal"],
			["handoff", "journal", "handoff"],
			["questions", "questions", undefined],
			["context", "text", undefined],
			["constraints", "checklist", undefined],
			["criteria", "checklist", undefined],
			["plan", "steps", "plan"],
			["follow-ups", "checklist", undefined],
			["decisions", "journal", undefined],
			["findings", "journal", undefined],
			["change-log", "journal", undefined],
		]);
		expect(sections.find((entry) => entry.id === "findings")).toMatchObject({
			collects: expect.stringContaining("Facts learned"),
			fields: ["evidence", "status?"],
		});
		const plan = (await call("read_workbook", { section: "plan" })).markdown;
		expect(plan).toContain("**1. Refine");
		expect(plan).toContain("  - [ ] Confirm the Plan (you)");
		expect((await call("read_workbook", { section: "questions" })).markdown).toBe(
			"_Things only the user can decide. When one is answered, record the decision and the question goes._",
		);
		expect((await call("read_workbook", { section: "guide" })).markdown).toContain(
			"Extract, don't archive",
		);
		await expect(call("read_workbook", { section: "nope" })).rejects.toThrow('no "nope" section');
	});

	it("add numbered steps with their tasks, and add and tick tasks under a step", async () => {
		const { call, section, pages, workbook } = await boot();

		await expect(
			call("add_item", {
				section: "plan",
				text: "Ship it",
				detail: "release",
				tasks: ["Write notes", "Approve the release (you)"],
			}),
		).resolves.toMatchObject({ section: "plan", step: 2 });
		expect(section("plan")).toContain(
			"  - [ ] Confirm the Plan (you)\n- [ ] **2. Ship it**: release\n  - [ ] Write notes\n  - [ ] Approve the release (you)",
		);
		const plan = workbook.sections.find((entry) => entry.id === "plan")!;
		expect(pages.pages.get(plan.pageId!)!.blocks).toHaveLength(1);

		await call("add_task", { step: "1", text: "**brief.md**: say who it's for" });
		expect(section("plan")).toContain(
			"  - [ ] Confirm the Plan (you)\n  - [ ] **brief.md**: say who it's for\n- [ ] **2. Ship it**",
		);
		await call("add_task", { step: "ship", text: "Tag it" });
		expect(section("plan")).toMatch(/Approve the release \(you\)\n {2}- \[ \] Tag it$/);

		await expect(call("set_task_done", { step: "2", task: "write notes" })).resolves.toMatchObject({
			line: "  - [x] Write notes",
		});
		await call("set_task_done", { step: "2", task: "write notes", done: false });
		expect(section("plan")).toContain("  - [ ] Write notes");
		await expect(call("set_task_done", { step: "2", task: "lunch" })).rejects.toThrow(
			'Step 2 has no task matching "lunch"',
		);
		await expect(call("set_task_done", { step: "1", task: "the" })).rejects.toThrow(
			"use more of its words",
		);
		await expect(
			call("set_status", { item: "write notes", status: "in_progress" }),
		).rejects.toThrow('No plan step matches "write notes"');
	});

	it("set a step's status under the plan's rules: tasks ticked, and a link or a reason", async () => {
		const { call, section } = await boot();
		await call("add_item", {
			section: "plan",
			text: "Build it",
			detail: "make it work",
			tasks: ["Code"],
		});

		await call("set_status", { item: "2", status: "in_progress" });
		expect(section("plan")).toContain("- [ ] **2. Build it**: make it work · in progress");
		await expect(call("set_status", { item: "2", status: "blocked" })).rejects.toThrow(
			"Say what blocks it",
		);
		await call("set_status", { item: "2.", status: "blocked", reason: "waiting on review" });
		expect(section("plan")).toContain("**2. Build it**: make it work · blocked: waiting on review");

		await expect(call("set_status", { item: "2", status: "done", link: "abc" })).rejects.toThrow(
			"Say what was done",
		);
		await expect(
			call("set_status", { item: "2", status: "done", result: "shipped" }),
		).rejects.toThrow("needs its link");
		await expect(
			call("set_status", { item: "2", status: "done", result: "shipped", link: "abc123" }),
		).rejects.toThrow("Step 2 still has open tasks: Code");
		await call("set_task_done", { step: "2", task: "code" });
		await call("set_status", {
			item: "build it",
			status: "done",
			result: "shipped",
			link: "abc123",
		});
		expect(section("plan")).toContain(
			"- [x] **2. Build it**: make it work · done: shipped (abc123)",
		);

		await call("set_status", { item: "2", status: "todo" });
		expect(section("plan").split("\n")).toContain("- [ ] **2. Build it**: make it work");

		await call("set_task_done", { step: "1", task: "propose" });
		await call("set_task_done", { step: "1", task: "draft" });
		await call("set_task_done", { step: "1", task: "confirm" });
		await call("set_status", {
			item: "1",
			status: "done",
			result: "Plan confirmed",
			reason: "workbook only, no commit",
		});
		expect(section("plan")).toContain("· done: Plan confirmed (workbook only, no commit)");
		await expect(call("set_status", { item: "9", status: "in_progress" })).rejects.toThrow(
			'No plan step matches "9"',
		);
		await expect(call("set_status", { item: "**", status: "in_progress" })).rejects.toThrow(
			"use the step number",
		);
	});

	it("re-cut the plan: edit, move and remove steps, renumbering them in order", async () => {
		const { call, section } = await boot();
		await call("add_item", { section: "plan", text: "Two", detail: "b", tasks: ["t2"] });
		await call("add_item", { section: "plan", text: "Three", detail: "c" });
		await call("add_item", { section: "plan", text: "Four", detail: "d" });
		await call("set_status", { item: "4", status: "in_progress" });

		await expect(
			call("edit_step", { step: "3", title: "Third", intent: "see" }),
		).resolves.toMatchObject({ line: "- [ ] **3. Third**: see" });
		await call("edit_step", { step: "4", title: "Fourth" });
		expect(section("plan")).toContain("- [ ] **4. Fourth**: d · in progress");
		await expect(call("edit_step", { step: "4" })).rejects.toThrow("new title or intent");

		await expect(call("move_step", { step: "4", before: "2" })).resolves.toEqual({
			renumbered: [
				{ from: 4, to: 2 },
				{ from: 2, to: 3 },
				{ from: 3, to: 4 },
			],
		});
		expect(section("plan")).toMatch(
			/\*\*1\. Refine[\s\S]*- \[ \] \*\*2\. Fourth\*\*: d · in progress\n- \[ \] \*\*3\. Two\*\*: b\n {2}- \[ \] t2\n- \[ \] \*\*4\. Third\*\*: see$/,
		);
		await call("move_step", { step: "Fourth", after: "Third" });
		expect(section("plan")).toMatch(
			/\*\*2\. Two\*\*: b\n {2}- \[ \] t2\n- \[ \] \*\*3\. Third\*\*: see\n- \[ \] \*\*4\. Fourth\*\*/,
		);
		await expect(call("move_step", { step: "2" })).rejects.toThrow("before, or after");

		await expect(call("remove_item", { section: "plan", item: "2" })).resolves.toMatchObject({
			removed: "- [ ] **2. Two**: b",
			renumbered: [
				{ from: 3, to: 2 },
				{ from: 4, to: 3 },
			],
		});
		expect(section("plan")).not.toContain("t2");
		expect(section("plan")).toMatch(/\*\*2\. Third\*\*: see\n- \[ \] \*\*3\. Fourth\*\*/);

		await call("set_task_done", { step: "1", task: "propose" });
		await call("set_task_done", { step: "1", task: "draft" });
		await call("set_task_done", { step: "1", task: "confirm" });
		await call("set_status", { item: "1", status: "done", result: "ok", reason: "no commit" });
		await expect(call("remove_item", { section: "plan", item: "1" })).rejects.toThrow(
			"part of the record",
		);
	});

	it("keep journals: entries with their fields, newest first where the section says, superseded never deleted", async () => {
		const { call, section } = await boot();

		await expect(call("add_item", { section: "decisions", text: "Use SSE" })).rejects.toThrow(
			"needs why",
		);
		await expect(
			call("add_item", {
				section: "decisions",
				text: "Use SSE",
				fields: { why: "simpler", how: "x" },
			}),
		).rejects.toThrow("has no field how (its fields: why, rejected)");
		await call("add_item", {
			section: "decisions",
			text: "Use a run-time flag",
			fields: { why: "local testing", rejected: "build-time" },
		});
		expect(section("decisions")).toContain(
			`- **Use a run-time flag.** Why: local testing. Rejected: build-time. (${today()})`,
		);

		await call("add_item", {
			section: "decisions",
			text: "Reversal: choose the server line at build time",
			fields: { why: "short-lived" },
			supersedes: "run-time flag",
		});
		expect(section("decisions")).toContain(
			`- ~~**Use a run-time flag.** Why: local testing. Rejected: build-time. (${today()})~~ Superseded by: Reversal: choose the server line at build time. (${today()})\n- **Reversal: choose the server line at build time.** Why: short-lived. (${today()})`,
		);

		await call("add_item", {
			section: "findings",
			text: "v2 has no telemetry",
			fields: { evidence: "no sink in kilo-plugin", status: "toggle is a no-op (step 7)" },
		});
		expect(section("findings")).toContain(
			`- **v2 has no telemetry.** Evidence: no sink in kilo-plugin. Status: toggle is a no-op (step 7). (${today()})`,
		);
		await call("supersede", {
			section: "findings",
			item: "telemetry",
			by: "telemetry arrives in 0.0.0-v2-300",
		});
		expect(section("findings")).toMatch(
			/^- ~~\*\*v2 has no telemetry\.\*\*[^~]*~~ Superseded by: telemetry arrives in 0\.0\.0-v2-300\./m,
		);
		await expect(
			call("supersede", { section: "findings", item: "telemetry", by: "x" }),
		).rejects.toThrow('Nothing in Findings matches "telemetry"');
		await expect(call("supersede", { section: "plan", item: "1", by: "x" })).rejects.toThrow(
			"isn't a journal",
		);
		await expect(call("remove_item", { section: "findings", item: "telemetry" })).rejects.toThrow(
			"supersede it instead",
		);
	});

	it("keep checklists, on their own page or under a heading, and file questions until they're answered", async () => {
		const { call, section, host, workbook } = await boot();

		await call("add_item", { section: "follow-ups", text: "Dark mode", detail: "asked for" });
		await call("add_item", { section: "follow-ups", text: "Later thing" });
		expect(section("follow-ups")).toMatch(
			/^_Out-of-scope work[^\n]*_\n\n- \[ \] Dark mode \(asked for\)\n- \[ \] Later thing$/,
		);
		await call("set_status", { section: "follow-ups", item: "dark", status: "done" });
		expect(section("follow-ups")).toContain("- [x] Dark mode (asked for)");
		await expect(
			call("set_status", { section: "follow-ups", item: "later", status: "blocked", reason: "x" }),
		).rejects.toThrow("either done or todo");
		await call("remove_item", { section: "follow-ups", item: "later" });
		expect(section("follow-ups")).not.toContain("Later thing");

		await call("add_item", { section: "criteria", text: "A build variable picks v1 or v2" });
		expect(section("criteria")).toContain("- [ ] A build variable picks v1 or v2");

		await call("add_item", { section: "questions", text: "Support Windows", detail: "CI cost" });
		await call("add_item", { section: "questions", text: "Which branch is v2?" });
		expect(section("questions")).toContain(
			"- **Support Windows?** CI cost\n- **Which branch is v2?**",
		);
		await expect(
			host.invoke(Workbooks, "progress", { workbookId: workbook.id }),
		).resolves.toMatchObject({
			openQuestions: 2,
		});

		await expect(
			call("answer_question", {
				question: "branch",
				recordIn: "decisions",
				text: "The v2 reference is origin/v2",
				fields: { why: "its AGENTS.md says so" },
			}),
		).resolves.toMatchObject({
			removed: "- **Which branch is v2?**",
			recorded: `- **The v2 reference is origin/v2.** Why: its AGENTS.md says so. (${today()})`,
		});
		expect(section("questions")).not.toContain("branch");
		expect(section("decisions")).toContain("The v2 reference is origin/v2");
		await expect(
			call("answer_question", { question: "windows", recordIn: "follow-ups", text: "No" }),
		).rejects.toThrow("journal section");
		await call("answer_question", { question: "windows" });
		await expect(
			host.invoke(Workbooks, "progress", { workbookId: workbook.id }),
		).resolves.toMatchObject({
			openQuestions: 0,
		});
	});

	it("write text sections, and the goal only with the user's say-so", async () => {
		const { call, section, brief } = await boot();

		await call("write_section", {
			section: "context",
			markdown: "- Branch: kilo/v2\n- PR: none yet",
		});
		expect(section("context")).toBe(
			"_Where things are: the issue, upstream references, entry points in the code, the branch and PR once they exist, local tools and environments._\n\n- Branch: kilo/v2\n- PR: none yet",
		);
		expect(brief()).toMatch(/- PR: none yet\n\n## Constraints and non-goals/);

		await expect(
			call("write_section", { section: "goal", markdown: "Something else" }),
		).rejects.toThrow("changes only when the user asks");
		await call("write_section", {
			section: "goal",
			markdown: "Fix the bug for good",
			userConfirmed: true,
		});
		expect(section("goal")).toMatch(/^_[^\n]*_\n\nFix the bug for good$/);
		await expect(call("write_section", { section: "plan", markdown: "x" })).rejects.toThrow(
			"holds items",
		);
		await expect(call("add_item", { section: "context", text: "x" })).rejects.toThrow(
			"write_section",
		);
	});

	it("hand off: replace Where we left off, keeping its note, and log each entry newest first", async () => {
		const { call, section, brief, host, workbook } = await boot();

		await expect(
			call("hand_off", { title: "Step 2 done (commit abc)", text: "Next: step 3.", who: "agent" }),
		).resolves.toEqual({
			written: `- **Step 2 done (commit abc).** Next: step 3. (${today()}, agent)`,
			history: "change-log",
		});
		await call("hand_off", { title: "Step 3 done", text: "Next: step 4." });

		expect(brief()).toMatch(
			new RegExp(
				`## Where we left off\\n\\n_The latest change only;[^\\n]*_\\n\\n- \\*\\*Step 3 done\\.\\*\\* Next: step 4\\. \\(${today()}\\)\\n\\n## Open questions`,
			),
		);
		expect(brief()).not.toContain("Nothing yet.");
		expect(brief()).not.toContain("Step 2 done");
		expect(section("change-log")).toMatch(
			new RegExp(
				`^_Every handoff[^\\n]*_\\n\\n- \\*\\*Step 3 done\\.\\*\\* Next: step 4\\. \\(${today()}\\)\\n- \\*\\*Step 2 done \\(commit abc\\)\\.\\*\\* Next: step 3\\. \\(${today()}, agent\\)$`,
			),
		);
		await expect(
			host.invoke(Workbooks, "progress", { workbookId: workbook.id }),
		).resolves.toMatchObject({
			whereWeLeftOff: [`**Step 3 done.** Next: step 4. (${today()})`],
		});
		await expect(call("add_item", { section: "handoff", text: "x" })).rejects.toThrow("hand_off");
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
		const { call, pages, section } = await boot();
		const original = pages.call.bind(pages);
		let raced = false;
		pages.call = async (tool, args) => {
			if (tool === "edit_page" && !raced) {
				raced = true;
				throw new Error("stale_revision");
			}
			return original(tool, args);
		};

		await call("add_item", { section: "follow-ups", text: "After a race" });

		expect(section("follow-ups")).toContain("- [ ] After a race");
	});
});

describe("workbooks whose pages differ from their template", () => {
	it("add a missing heading at the end of the page", async () => {
		const { call, host, pages } = await boot();
		const projectId = pages.addProject("No headings", "", ["Plan"]);
		const [plan] = pages.pagesOf(projectId).map((entry) => entry.id);
		const bare = await host.invoke(Workbooks, "add", {
			workspaceId: null,
			name: "No headings",
			templateId: "custom",
			backend: { kind: "pages-mcp", server: "pages" },
			projectId,
			sections: [
				{ id: "tasks", title: "Tasks", type: "checklist", pageId: plan!, heading: "Tasks" },
			],
		});

		await call("add_item", { section: "tasks", text: "First", workbookId: bare.id });
		await call("add_item", { section: "tasks", text: "Second", workbookId: bare.id });

		expect(pages.markdown(plan!)).toBe("## Tasks\n\n- [ ] First\n- [ ] Second");
	});

	it("say which sections there are, and which role is missing", async () => {
		const { call, host, workbook } = await boot();
		const { id: _, createdAt: __, lastUsedAt: ___, usedIn: ____, ...reference } = workbook;
		const bare = await host.invoke(Workbooks, "add", {
			...reference,
			projectId: "prj_bare",
			workspaceId: null,
			name: "Bare",
			sections: [{ id: "notes", type: "journal", pageId: workbook.guidePageId! }],
		});

		await expect(call("add_task", { step: "1", text: "x", workbookId: bare.id })).rejects.toThrow(
			"no plan section",
		);
		await expect(
			call("add_item", { section: "tasks", text: "x", workbookId: bare.id }),
		).rejects.toThrow("(it has: notes)");
	});
});

describe("withStatus and replaceBodyEdits", () => {
	it("set a step's checkbox and suffix", () => {
		expect(withStatus("- [x] **3. A** · done: x", "blocked", "waiting")).toBe(
			"- [ ] **3. A** · blocked: waiting",
		);
	});

	it("replace a section's body, keeping its note, however Pages splits the blocks", () => {
		const body = "- new";
		expect(
			replaceBodyEdits(
				[
					{ node_id: "h", markdown: "## Where we left off" },
					{ node_id: "a", markdown: "_note_" },
					{ node_id: "b", markdown: "- old" },
					{ node_id: "c", markdown: "older" },
					{ node_id: "g", markdown: "## Goal" },
				],
				"Where we left off",
				body,
			),
		).toEqual([
			{ op: "delete_block", node_id: "b" },
			{ op: "delete_block", node_id: "c" },
			{ op: "replace_block_markdown", node_id: "a", markdown: "_note_\n\n- new" },
		]);
		expect(
			replaceBodyEdits(
				[
					{
						node_id: "b",
						markdown: "## Where we left off\n\n*note*\n\n**Bold** old\n\n## Goal\n\nG",
					},
				],
				"Where we left off",
				body,
			),
		).toEqual([
			{
				op: "replace_block_markdown",
				node_id: "b",
				markdown: "## Where we left off\n\n*note*\n\n- new\n\n## Goal\n\nG",
			},
		]);
		expect(replaceBodyEdits([{ node_id: "p", markdown: "Hi" }], "Where we left off", body)).toEqual(
			[{ op: "insert_markdown", markdown: "## Where we left off\n\n- new" }],
		);
		expect(replaceBodyEdits([], undefined, body)).toEqual([
			{ op: "insert_markdown", after_node_id: null, markdown: "- new" },
		]);
	});
});
