import { NotebookIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
	activityKindFromGroupKey,
	formatMcpServerLabel,
	formatToolDisplayName,
	getActivityKind,
	getGroupKeyForTool,
	getKindMeta,
	getMcpServerFromToolName,
	getSegmentStats,
	indicesHavePendingAsk,
	lastAskingPartIndex,
	summarizeActivity,
	type ActivityPart,
} from "./tool-categories";

describe("task-list activity presentation", () => {
	it("omits projected task-list calls from tool counts and icon stacks", () => {
		const parts: ActivityPart[] = [
			{ type: "reasoning", status: { type: "complete" } },
			{ type: "tool-call", toolName: "todowrite", status: { type: "complete" } },
			{ type: "tool-call", toolName: "read", status: { type: "complete" } },
			{ type: "tool-call", toolName: "todoread", status: { type: "complete" } },
		];

		expect(parts.map(getActivityKind)).toEqual(["thinking", undefined, "reading", undefined]);
		const summary = summarizeActivity(
			parts,
			parts.map((_, index) => index),
		);
		expect(summary.toolCount).toBe(1);
		expect(summary.iconItems.map((item) => item.label)).toEqual(["Thinking", "Reading"]);
	});
});

describe("getMcpServerFromToolName", () => {
	it("extracts the server prefix from MCP-style tool names", () => {
		expect(getMcpServerFromToolName("atlassian_getJiraIssue")).toBe("atlassian");
		expect(getMcpServerFromToolName("atlassian_getAccessibleAtlassianResources")).toBe("atlassian");
		expect(getMcpServerFromToolName("my-server_search")).toBe("my-server");
		expect(getMcpServerFromToolName("notebooks_create_cell")).toBe("notebooks");
	});

	it("ignores built-in tools even when they contain underscores", () => {
		expect(getMcpServerFromToolName("plan_exit")).toBeUndefined();
		expect(getMcpServerFromToolName("notebook_edit")).toBeUndefined();
		expect(getMcpServerFromToolName("codebase_search")).toBeUndefined();
		expect(getMcpServerFromToolName("ask_question")).toBeUndefined();
		expect(getMcpServerFromToolName("request_user_input")).toBeUndefined();
	});

	it("ignores names without a server_tool shape", () => {
		expect(getMcpServerFromToolName("read")).toBeUndefined();
		expect(getMcpServerFromToolName("_orphan")).toBeUndefined();
		expect(getMcpServerFromToolName("atlassian_")).toBeUndefined();
	});
});

describe("asking activity grouping", () => {
	it("maps question tools into the asking subgroup", () => {
		expect(getGroupKeyForTool("question")).toBe("group-asking");
		expect(getGroupKeyForTool("ask_question")).toBe("group-asking");
		expect(getGroupKeyForTool("request_user_input")).toBe("group-asking");
		expect(activityKindFromGroupKey("group-asking")).toBe("asking");
	});

	it("labels live and completed question states", () => {
		expect(getKindMeta("asking").liveLabel({ count: 1, files: 0 })).toBe("Asking");
		expect(getKindMeta("asking").doneLabel({ count: 1, files: 0, question: "Next task" })).toBe(
			"Asked Next task",
		);
		expect(getKindMeta("asking").doneLabel({ count: 2, files: 0 })).toBe("Asked 2 questions");
	});

	it("pulls the question prompt into segment stats", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "question",
				args: {
					questions: [{ header: "Next task", question: "What would you like to work on next?" }],
				},
				status: { type: "complete" },
			},
		];
		const stats = getSegmentStats(parts, {
			kind: "asking",
			indices: [0],
			running: false,
			requiresAction: false,
		});
		expect(stats.question).toBe("What would you like to work on next?");
	});

	it("falls back to the question's header, its count, or a bare prompt", () => {
		const question = (args: unknown) =>
			getSegmentStats([{ type: "tool-call", toolName: "question", args }], {
				kind: "asking",
				indices: [0],
				running: false,
				requiresAction: false,
			}).question;
		expect(question({ questions: [{ header: "Env" }] })).toBe("Env");
		expect(question({ questions: [{}, {}] })).toBe("2 questions");
		expect(question({ prompt: "Go on?" })).toBe("Go on?");
		expect(question("nope")).toBeUndefined();
	});

	it("matches only the pending ask tool call, not prior asks", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "question",
				toolCallId: "call-old",
				status: { type: "complete" },
			},
			{ type: "text" },
			{
				type: "tool-call",
				toolName: "question",
				toolCallId: "call-new",
				status: { type: "complete" },
			},
		];
		expect(indicesHavePendingAsk(parts, [0], new Set(["call-new"]))).toBe(false);
		expect(indicesHavePendingAsk(parts, [2], new Set(["call-new"]))).toBe(true);
		expect(lastAskingPartIndex(parts)).toBe(2);
	});
});

describe("terminal activity labels", () => {
	it("uses the command description for a single terminal tool", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "shell",
				args: { command: "pnpm test", description: "Run unit tests" },
				status: { type: "running" },
			},
		];
		const stats = getSegmentStats(parts, {
			kind: "terminal",
			indices: [0],
			running: true,
			requiresAction: false,
		});

		expect(stats.commandSummary).toBe("Run unit tests");
		expect(getKindMeta("terminal").liveLabel(stats)).toBe("Running Run unit tests");
		expect(getKindMeta("terminal").doneLabel(stats)).toBe("Ran Run unit tests");
	});
});

describe("skill activity grouping", () => {
	it("maps the skill tool into its own subgroup", () => {
		expect(getGroupKeyForTool("skill")).toBe("group-skill");
		expect(getGroupKeyForTool("Skill")).toBe("group-skill");
		expect(activityKindFromGroupKey("group-skill")).toBe("skill");
		expect(getActivityKind({ type: "tool-call", toolName: "skill" })).toBe("skill");
	});

	it("does not treat skill as an MCP server prefix", () => {
		expect(getMcpServerFromToolName("skill")).toBeUndefined();
	});

	it("labels live and completed skill states", () => {
		expect(getKindMeta("skill").liveLabel({ count: 1, files: 0, skill: "write-vitest" })).toBe(
			"Reading Skill",
		);
		expect(getKindMeta("skill").doneLabel({ count: 1, files: 0, skill: "write-vitest" })).toBe(
			"Read Skill",
		);
		expect(getKindMeta("skill").doneLabel({ count: 2, files: 0 })).toBe("Read 2 Skills");
	});

	it("pulls the skill name into segment stats", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "skill",
				args: { id: "write-vitest" },
				status: { type: "complete" },
			},
		];
		const stats = getSegmentStats(parts, {
			kind: "skill",
			indices: [0],
			running: false,
			requiresAction: false,
		});
		expect(stats.skill).toBe("write-vitest");
	});

	it("omits a skill name when the subgroup loaded more than one", () => {
		const parts: ActivityPart[] = [
			{ type: "tool-call", toolName: "skill", args: { id: "write-vitest" } },
			{ type: "tool-call", toolName: "skill", args: { id: "write-e2e-test" } },
		];
		const stats = getSegmentStats(parts, {
			kind: "skill",
			indices: [0, 1],
			running: false,
			requiresAction: false,
		});
		expect(stats.skill).toBeUndefined();
		expect(getKindMeta("skill").doneLabel(stats)).toBe("Read 2 Skills");
	});

	it("keeps skill calls out of the generic tools group", () => {
		const parts: ActivityPart[] = [
			{ type: "tool-call", toolName: "skill", args: { id: "write-vitest" } },
			{ type: "tool-call", toolName: "mystery" },
		];
		expect(parts.map(getActivityKind)).toEqual(["skill", "tools"]);
		const summary = summarizeActivity(
			parts,
			parts.map((_, i) => i),
		);
		expect(summary.segments.map((s) => s.kind)).toEqual(["skill", "tools"]);
		expect(summary.iconItems.map((i) => i.label)).toEqual(["Skill", "Tools"]);
	});
});

describe("subagent activity grouping", () => {
	it("presents board coordination as subagent activity rather than MCP tools", () => {
		expect(getGroupKeyForTool("board_read")).toBe("group-subagent");
		expect(getGroupKeyForTool("board_post")).toBe("group-subagent");
		expect(getMcpServerFromToolName("board_read")).toBeUndefined();
		expect(getMcpServerFromToolName("board_post")).toBeUndefined();
		expect(formatToolDisplayName("board_read")).toBe("Read agent messages");
		expect(formatToolDisplayName("board_post")).toBe("Message agents");
	});

	it("keeps subagent calls out of activity kinds so they render as delegation rows", () => {
		expect(activityKindFromGroupKey("group-subagent")).toBe("subagent");
		expect(getActivityKind({ type: "tool-call", toolName: "subagent" })).toBeUndefined();
		expect(getActivityKind({ type: "tool-call", toolName: "Subagent" })).toBeUndefined();
	});

	it("does not treat subagent as an MCP server prefix", () => {
		expect(getMcpServerFromToolName("subagent")).toBeUndefined();
	});

	it("labels live and completed subagent states", () => {
		expect(getKindMeta("subagent").liveLabel({ count: 1, files: 0 })).toBe("Delegating...");
		expect(
			getKindMeta("subagent").liveLabel({ count: 1, files: 0, task: "Explore auth flow" }),
		).toBe("Delegating Explore auth flow");
		expect(
			getKindMeta("subagent").doneLabel({ count: 1, files: 0, task: "Explore auth flow" }),
		).toBe("Delegated Explore auth flow");
		expect(getKindMeta("subagent").doneLabel({ count: 2, files: 0 })).toBe("Delegated 2 subagents");
	});

	it("pulls the task description into segment stats", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "subagent",
				args: {
					description: "Explore auth flow",
					prompt: "Find how login works.",
					agent: "explore",
				},
				status: { type: "complete" },
			},
		];
		const stats = getSegmentStats(parts, {
			kind: "subagent",
			indices: [0],
			running: false,
			requiresAction: false,
		});
		expect(stats.task).toBe("Explore auth flow");
	});

	it("collapses whitespace in the task description", () => {
		const stats = getSegmentStats(
			[{ type: "tool-call", toolName: "subagent", args: { description: "  Audit\n login " } }],
			{ kind: "subagent", indices: [0], running: false, requiresAction: false },
		);
		expect(stats.task).toBe("Audit login");
	});

	it("falls back to the agent type when the description is missing", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "subagent",
				args: { prompt: "Review the diff.", agent: "code-reviewer" },
			},
		];
		const stats = getSegmentStats(parts, {
			kind: "subagent",
			indices: [0],
			running: false,
			requiresAction: false,
		});
		expect(stats.task).toBe("code-reviewer");
	});

	it("omits a task description when the subgroup launched more than one", () => {
		const parts: ActivityPart[] = [
			{ type: "tool-call", toolName: "subagent", args: { description: "Explore auth" } },
			{ type: "tool-call", toolName: "subagent", args: { description: "Review the patch" } },
		];
		const stats = getSegmentStats(parts, {
			kind: "subagent",
			indices: [0, 1],
			running: false,
			requiresAction: false,
		});
		expect(stats.task).toBeUndefined();
		expect(getKindMeta("subagent").doneLabel(stats)).toBe("Delegated 2 subagents");
	});

	it("omits task calls from activity counts and icon stacks", () => {
		const parts: ActivityPart[] = [
			{ type: "tool-call", toolName: "skill", args: { id: "write-vitest" } },
			{ type: "tool-call", toolName: "subagent", args: { description: "Explore auth" } },
		];
		expect(parts.map(getActivityKind)).toEqual(["skill", undefined]);
		const summary = summarizeActivity(
			parts,
			parts.map((_, i) => i),
		);
		expect(summary.segments.map((s) => s.kind)).toEqual(["skill"]);
		expect(summary.iconItems.map((i) => i.label)).toEqual(["Skill"]);
	});
});

describe("terminal activity labels", () => {
	it("shows the command count for multiple terminal tools", () => {
		const parts: ActivityPart[] = [
			{ type: "tool-call", toolName: "shell", args: { command: "pnpm lint" } },
			{ type: "tool-call", toolName: "shell", args: { command: "pnpm test" } },
		];
		const stats = getSegmentStats(parts, {
			kind: "terminal",
			indices: [0, 1],
			running: true,
			requiresAction: false,
		});

		expect(stats.commandSummary).toBeUndefined();
		expect(getKindMeta("terminal").liveLabel(stats)).toBe("Running 2 commands");
		expect(getKindMeta("terminal").doneLabel(stats)).toBe("Ran 2 commands");
	});
});

describe("MCP activity grouping", () => {
	it("maps consecutive same-server tools into one mcp subgroup key", () => {
		expect(getGroupKeyForTool("atlassian_getJiraIssue")).toBe("group-mcp-atlassian");
		expect(getGroupKeyForTool("atlassian_search")).toBe("group-mcp-atlassian");
		expect(activityKindFromGroupKey("group-mcp-atlassian")).toBe("mcp:atlassian");
	});

	it("labels MCP servers in title case", () => {
		expect(formatMcpServerLabel("atlassian")).toBe("Atlassian");
		expect(formatMcpServerLabel("my-server")).toBe("My Server");
		expect(getKindMeta("mcp:atlassian").doneLabel({ count: 2, files: 0 })).toBe("Atlassian");
		expect(getKindMeta("mcp:atlassian").icon).not.toBe(NotebookIcon);
	});

	it("presents notebooks as a Notebook group with the notebook tab icon", () => {
		expect(getGroupKeyForTool("notebooks_create_cell")).toBe("group-mcp-notebooks");
		expect(getActivityKind({ type: "tool-call", toolName: "notebooks_create_cell" })).toBe(
			"mcp:notebooks",
		);
		const meta = getKindMeta("mcp:notebooks");
		expect(meta.label).toBe("Notebook");
		expect(meta.icon).toBe(NotebookIcon);
		expect(meta.liveLabel({ count: 1, files: 0 })).toBe("Notebook...");
		expect(meta.doneLabel({ count: 1, files: 0 })).toBe("Notebook");
		expect(meta.circleClassName).toContain("teal");
	});

	it("uses the tool display name for a single notebooks tool", () => {
		const parts: ActivityPart[] = [
			{
				type: "tool-call",
				toolName: "notebooks_create_cell",
				status: { type: "running" },
			},
		];
		const stats = getSegmentStats(parts, {
			kind: "mcp:notebooks",
			indices: [0],
			running: true,
			requiresAction: false,
		});

		expect(stats.tool).toBe("Create cell");
		expect(getKindMeta("mcp:notebooks").liveLabel(stats)).toBe("Notebook Create cell...");
		expect(getKindMeta("mcp:notebooks").doneLabel(stats)).toBe("Notebook Create cell");
	});

	it("keeps the group label when more than one notebooks tool is running", () => {
		const parts: ActivityPart[] = [
			{ type: "tool-call", toolName: "notebooks_create_cell" },
			{ type: "tool-call", toolName: "notebooks_execute_cell" },
		];
		const stats = getSegmentStats(parts, {
			kind: "mcp:notebooks",
			indices: [0, 1],
			running: true,
			requiresAction: false,
		});

		expect(stats.tool).toBeUndefined();
		expect(getKindMeta("mcp:notebooks").liveLabel(stats)).toBe("Notebook...");
		expect(getKindMeta("mcp:notebooks").doneLabel(stats)).toBe("Notebook");
	});

	it("gives notebooks tools display names without the server prefix", () => {
		expect(formatToolDisplayName("notebooks_create_notebook")).toBe("Create notebook");
		expect(formatToolDisplayName("notebooks_connect_notebook")).toBe("Connect notebook");
		expect(formatToolDisplayName("notebooks_execute_cell")).toBe("Run cell");
		expect(formatToolDisplayName("notebooks_brand_new_tool")).toBe("Brand new tool");
		expect(formatToolDisplayName("atlassian_getJiraIssue")).toBe("Get jira issue");
		expect(formatToolDisplayName("shell")).toBe("shell");
	});

	it("coalesces thinking / Atlassian / thinking / Atlassian into four segments", () => {
		const parts: ActivityPart[] = [
			{ type: "reasoning", status: { type: "complete" } },
			{ type: "tool-call", toolName: "atlassian_getJiraIssue", status: { type: "complete" } },
			{ type: "tool-call", toolName: "atlassian_search", status: { type: "complete" } },
			{ type: "reasoning", status: { type: "complete" } },
			{ type: "tool-call", toolName: "atlassian_getJiraIssue", status: { type: "complete" } },
		];

		expect(parts.map(getActivityKind)).toEqual([
			"thinking",
			"mcp:atlassian",
			"mcp:atlassian",
			"thinking",
			"mcp:atlassian",
		]);

		const summary = summarizeActivity(
			parts,
			parts.map((_, i) => i),
		);
		expect(summary.segments.map((s) => s.kind)).toEqual([
			"thinking",
			"mcp:atlassian",
			"thinking",
			"mcp:atlassian",
		]);
		expect(summary.segments[1]?.indices).toEqual([1, 2]);
		expect(summary.segments[3]?.indices).toEqual([4]);
		expect(summary.iconItems.map((i) => i.label)).toEqual([
			"Thinking",
			"Atlassian",
			"Thinking",
			"Atlassian",
		]);
	});
});
