import { describe, expect, it } from "vitest";

import { agentActivityOf, type SessionMessageLike } from "./agent-activity";

const user = (created: number, text: string, extra: Record<string, unknown> = {}) => ({
	info: { role: "user", time: { created } },
	parts: [{ type: "text", text, ...extra }],
});

const assistant = (created: number, parts: Record<string, unknown>[]): SessionMessageLike => ({
	info: { role: "assistant", time: { created } },
	parts,
});

let nextId = 0;
const tool = (
	name: string,
	state: Record<string, unknown>,
	id = `part_${(nextId += 1)}`,
): Record<string, unknown> => ({ id, type: "tool", tool: name, callID: `call_${id}`, state });

const done = (input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	status: "completed",
	input,
	title: "",
	metadata: {},
	...extra,
});

describe("agentActivityOf", () => {
	it("is empty for a chat with no messages", () => {
		expect(agentActivityOf([])).toEqual({ steps: [], writingToBoard: false, editedFiles: [] });
	});

	it("takes the task from the first user message, skipping synthetic and ignored text", () => {
		const activity = agentActivityOf([
			user(5, "A later follow-up"),
			{
				info: { role: "user", time: { created: 1 } },
				parts: [
					{ type: "text", text: "hidden handoff", synthetic: true },
					{ type: "text", text: "Fix the webhook retries" },
					{ type: "text", text: "ignored", ignored: true },
					{ type: "file", url: "file:///a" },
				],
			},
		]);
		expect(activity.task).toBe("Fix the webhook retries");
	});

	it("lists the newest three tool calls oldest first, naming each", () => {
		const activity = agentActivityOf([
			user(1, "Do it"),
			assistant(2, [
				{ type: "text", text: "Looking around" },
				tool("read", done({ filePath: "/repo/src/a.ts" }, { title: "src/a.ts" })),
				tool("grep", done({ pattern: "retry\\(" }, { metadata: { matches: 4 } })),
				tool("todowrite", done({ todos: [] })),
			]),
			assistant(3, [
				tool("glob", done({ pattern: "**/*.test.ts" }, { metadata: { count: 5 } })),
				tool("bash", { status: "running", input: { command: "pnpm  test\n webhooks" } }),
			]),
		]);
		expect(activity.steps).toEqual([
			{
				id: expect.any(String),
				tool: "Grep",
				label: "retry\\(",
				status: "completed",
				detail: "4 matches",
			},
			{
				id: expect.any(String),
				tool: "Glob",
				label: "**/*.test.ts",
				status: "completed",
				detail: "5 files",
			},
			{ id: expect.any(String), tool: "Bash", label: "pnpm test webhooks", status: "running" },
		]);
		expect(activity.now).toBe("Bash · pnpm test webhooks");
	});

	it("says what runs now even when newer calls already finished", () => {
		const activity = agentActivityOf([
			assistant(1, [
				tool("bash", { status: "running", input: { command: "pnpm build" } }),
				tool("read", done({ filePath: "/r/a.ts" }, { title: "a.ts" })),
			]),
		]);
		expect(activity.now).toBe("Bash · pnpm build");
	});

	it("falls back to the newest call when nothing runs", () => {
		const activity = agentActivityOf([
			assistant(1, [
				tool("bash", done({ command: "ls" })),
				tool("read", done({ filePath: "/r/a.ts" }, { title: "a.ts" })),
			]),
		]);
		expect(activity.now).toBe("Read · a.ts");
	});

	it("counts an edit's lines from Kilo's metadata, or its diff", () => {
		const activity = agentActivityOf([
			assistant(1, [
				tool(
					"edit",
					done(
						{ filePath: "/repo/src/hooks.ts" },
						{ title: "src/hooks.ts", metadata: { filediff: { additions: 38, deletions: 12 } } },
					),
				),
				tool(
					"edit",
					done(
						{ filePath: "/repo/src/b.ts" },
						{
							title: "src/b.ts",
							metadata: { diff: "--- a/b.ts\n+++ b/b.ts\n@@\n-old\n+new\n+more\n" },
						},
					),
				),
				tool("edit", done({ filePath: "/repo/src/c.ts" }, { title: "src/c.ts" })),
			]),
		]);
		expect(activity.steps.map((step) => step.detail)).toEqual(["+38 −12", "+2 −1", undefined]);
	});

	it("shortens an absolute path while the call runs and Kilo hasn't titled it", () => {
		const activity = agentActivityOf([
			assistant(1, [
				tool("edit", { status: "running", input: { filePath: "/Users/me/repo/src/web/a.ts" } }),
			]),
		]);
		expect(activity.steps[0]?.label).toBe("…/src/web/a.ts");
		expect(activity.steps[0]?.detail).toBeUndefined();
	});

	it("marks failed calls and shows a failing command's exit code", () => {
		const activity = agentActivityOf([
			assistant(1, [
				tool("bash", { status: "error", input: { command: "pnpm lint" }, error: "boom" }),
				tool("bash", done({ command: "pnpm test" }, { metadata: { exit: 1 } })),
			]),
		]);
		expect(activity.steps.map((step) => [step.status, step.detail])).toEqual([
			["error", undefined],
			["completed", "exit 1"],
		]);
	});

	it("knows it's writing to the board only while its newest call is a running post", () => {
		const posting = (status: string, name = "board_post") =>
			agentActivityOf([
				assistant(1, [
					tool("read", done({ filePath: "/r/a.ts" })),
					tool(name, { status, input: { to: "main", body: "Found it\nDetails" } }),
				]),
			]);
		expect(posting("running").writingToBoard).toBe(true);
		expect(posting("pending").writingToBoard).toBe(true);
		expect(posting("running", "board_write").writingToBoard).toBe(true);
		expect(posting("completed").writingToBoard).toBe(false);
		expect(posting("running").now).toBe("Board post · Found it");

		const after = agentActivityOf([
			assistant(1, [
				tool("board_post", { status: "running", input: { body: "x" } }),
				tool("read", { status: "running", input: { filePath: "/r/a.ts" } }),
			]),
		]);
		expect(after.writingToBoard).toBe(false);
	});

	it("collects the distinct files it changed, patches included, but not failed edits", () => {
		const activity = agentActivityOf([
			assistant(1, [
				tool("edit", done({ filePath: "/repo/src/a.ts" }, { title: "src/a.ts" })),
				tool("write", done({ filePath: "/repo/src/new.ts" }, { title: "src/new.ts" })),
				tool("edit", { status: "error", input: { filePath: "/repo/src/bad.ts" }, error: "x" }),
			]),
			assistant(2, [
				tool(
					"apply_patch",
					done(
						{ patchText: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/c.ts\n" },
						{
							metadata: {
								files: [
									{ relativePath: "src/a.ts", additions: 3, deletions: 1 },
									{ relativePath: "src/c.ts", additions: 10, deletions: 0 },
								],
							},
						},
					),
				),
				tool(
					"apply_patch",
					done({ patchText: "*** Begin Patch\n*** Delete File: src/old.ts\n-gone\n" }),
				),
			]),
		]);
		expect(activity.editedFiles).toEqual(["src/a.ts", "src/new.ts", "src/c.ts", "src/old.ts"]);
		expect(activity.steps.slice(-2).map((step) => [step.label, step.detail])).toEqual([
			["src/a.ts", "2 files · +13 −1"],
			["src/old.ts", undefined],
		]);
	});

	it("orders messages by creation time, and tolerates missing fields", () => {
		const activity = agentActivityOf([
			assistant(3, [tool("bash", done({ command: "second" }))]),
			{ info: { role: "assistant" } },
			{ parts: [null, 4, { type: "tool" }, { type: "tool", tool: "bash" }] },
			assistant(2, [tool("bash", done({ command: "first" }))]),
			{} as SessionMessageLike,
		]);
		expect(activity.steps.map((step) => step.label)).toEqual(["first", "second", ""]);
		expect(activity.steps[2]).toMatchObject({ tool: "Bash", status: "running" });
		expect(activity.now).toBe("Bash");
	});

	it("names unknown and MCP tools readably", () => {
		const activity = agentActivityOf([
			assistant(1, [tool("notebooks_run_all_cells", done({ name: "analysis.ipynb" }))]),
		]);
		expect(activity.steps[0]).toMatchObject({
			tool: "Notebooks run all cells",
			label: "analysis.ipynb",
		});
	});
});
