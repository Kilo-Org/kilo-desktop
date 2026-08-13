import { describe, expect, it } from "vitest";

import {
	activityKindFromGroupKey,
	buildActivitySegments,
	formatMcpServerLabel,
	getActivityKind,
	getGroupKeyForTool,
	getKindMeta,
	getMcpServerFromToolName,
	getSegmentStats,
	indicesHavePendingAsk,
	lastAskingPartIndex,
	summarizeActivity,
	type ActivityPart,
} from "./tool-categories.js";

describe("getMcpServerFromToolName", () => {
	it("extracts the server prefix from MCP-style tool names", () => {
		expect(getMcpServerFromToolName("atlassian_getJiraIssue")).toBe("atlassian");
		expect(getMcpServerFromToolName("atlassian_getAccessibleAtlassianResources")).toBe("atlassian");
		expect(getMcpServerFromToolName("my-server_search")).toBe("my-server");
	});

	it("ignores built-in tools even when they contain underscores", () => {
		expect(getMcpServerFromToolName("apply_patch")).toBeUndefined();
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

	it("buildActivitySegments matches summarizeActivity boundaries", () => {
		const parts: ActivityPart[] = [
			{ type: "reasoning" },
			{ type: "tool-call", toolName: "atlassian_a" },
			{ type: "tool-call", toolName: "atlassian_b" },
		];
		const segments = buildActivitySegments(parts, [0, 1, 2]);
		expect(segments.map((s) => ({ kind: s.kind, indices: s.indices }))).toEqual([
			{ kind: "thinking", indices: [0] },
			{ kind: "mcp:atlassian", indices: [1, 2] },
		]);
	});
});
