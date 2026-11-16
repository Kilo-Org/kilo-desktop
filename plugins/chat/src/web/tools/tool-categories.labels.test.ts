import { afterEach, describe, expect, it } from "vitest";

import {
	activityKindFromGroupKey,
	getActivityKind,
	getGroupKeyForTool,
	getKindMeta,
	getPartQuestionSummary,
	getPartSkillName,
	getPartTaskDescription,
	getSegmentStats,
	setContributedToolCategories,
	soloRowHidesItself,
	type ActivityKind,
	type ActivityPart,
} from "./tool-categories";

const call = (
	toolName: string,
	args?: unknown,
	extra: Partial<ActivityPart> = {},
): ActivityPart => ({
	type: "tool-call",
	toolName,
	args,
	status: { type: "complete" },
	...extra,
});

const stats = (kind: ActivityKind, parts: ActivityPart[]) =>
	getSegmentStats(parts, { kind, indices: parts.map((_, index) => index) } as never);

afterEach(() => setContributedToolCategories(new Map()));

describe("each kind's labels", () => {
	const kinds: ActivityKind[] = [
		"thinking",
		"editing",
		"writing",
		"reading",
		"searching",
		"web",
		"terminal",
		"planning",
		"asking",
		"skill",
		"subagent",
		"tools",
		"mcp:github",
		"mcp:notebooks",
	];

	it.each(kinds)("names %s work in progress and done, for one and many", (kind) => {
		const meta = getKindMeta(kind);
		const one = {
			count: 1,
			files: 1,
			file: "a.ts",
			question: "Which?",
			commandSummary: "make",
			skill: "tdd",
			task: "Audit",
			tool: "List issues",
		};
		const many = { count: 3, files: 3 };
		for (const label of [
			meta.liveLabel(one),
			meta.doneLabel(one),
			meta.liveLabel(many),
			meta.doneLabel(many),
		]) {
			expect(label.length).toBeGreaterThan(0);
		}
		expect(meta.label.length).toBeGreaterThan(0);
	});
});

describe("contributed categories", () => {
	it("groups a contributed tool under its category, without overriding Kilo's", () => {
		setContributedToolCategories(
			new Map([
				["desktop_acme_ping", "web"],
				["read", "terminal"],
			]),
		);

		expect(getActivityKind(call("desktop_acme_ping"))).toBe("web");
		expect(getGroupKeyForTool("desktop_acme_ping")).toBe("group-web");
		expect(getActivityKind(call("read"))).toBe("reading");
	});
});

describe("group keys", () => {
	it("maps keys back to kinds", () => {
		expect(activityKindFromGroupKey("group-mcp-github")).toBe("mcp:github");
		expect(activityKindFromGroupKey("group-mcp-")).toBeUndefined();
		expect(activityKindFromGroupKey("group-nonsense")).toBeUndefined();
		expect(activityKindFromGroupKey("activity")).toBeUndefined();
		expect(getActivityKind({ type: "tool-call" })).toBe("tools");
		expect(getActivityKind({ type: "data" })).toBeUndefined();
	});
});

describe("part summaries", () => {
	it("summarises a question by its first prompt, header, or count", () => {
		expect(
			getPartQuestionSummary(call("question", { questions: [{ question: "Which env?" }] })),
		).toBe("Which env?");
		expect(getPartQuestionSummary(call("question", { questions: [{ header: "Env" }] }))).toBe(
			"Env",
		);
		expect(getPartQuestionSummary(call("question", { questions: [{}, {}] }))).toBe("2 questions");
		expect(getPartQuestionSummary(call("question", { prompt: "Go on?" }))).toBe("Go on?");
		expect(getPartQuestionSummary(call("question", "nope"))).toBeUndefined();
		expect(getPartQuestionSummary(call("read", {}))).toBeUndefined();
	});

	it("names a skill and a delegation", () => {
		expect(getPartSkillName(call("skill", { name: "tdd" }))).toBe("tdd");
		expect(getPartSkillName(call("skill"))).toBeUndefined();
		expect(getPartSkillName(call("read", { name: "x" }))).toBeUndefined();
		expect(getPartTaskDescription(call("task", { description: "  Audit\n login " }))).toBe(
			"Audit login",
		);
		expect(getPartTaskDescription(call("task", { subagent_type: "explore" }))).toBe("explore");
		expect(getPartTaskDescription(call("task", {}))).toBeUndefined();
		expect(getPartTaskDescription(call("task"))).toBeUndefined();
	});

	it("collects a segment's stats by kind", () => {
		expect(
			stats("asking", [call("question", { questions: [{ question: "Which?" }] })]).question,
		).toBe("Which?");
		expect(stats("terminal", [call("bash", { command: "make test" })]).commandSummary).toBe(
			"make test",
		);
		expect(stats("skill", [call("skill", { name: "tdd" })]).skill).toBe("tdd");
		expect(
			stats("subagent", [call("task", { description: "A" }), call("task", { description: "B" })])
				.task,
		).toBeUndefined();
		expect(stats("mcp:github", [call("github_list_issues")]).tool).toBe("List issues");
		expect(
			stats("editing", [call("apply_patch", { patchText: "*** Update File: a.ts\n+x" })]).files,
		).toBe(1);
	});
});

describe("soloRowHidesItself", () => {
	it("hides a quiet successful command but not a failed or cancelled one", () => {
		expect(soloRowHidesItself("terminal", call("bash", {}, { result: "" }))).toBe(true);
		expect(soloRowHidesItself("terminal", call("bash", {}, { result: "out" }))).toBe(false);
		expect(
			soloRowHidesItself(
				"terminal",
				call("bash", {}, { status: { type: "incomplete", reason: "cancelled" } as never }),
			),
		).toBe(false);
		expect(soloRowHidesItself("terminal", undefined)).toBe(false);
	});

	it("hides a delegation without output", () => {
		expect(soloRowHidesItself("subagent", call("task", {}, { result: "" }))).toBe(true);
		expect(
			soloRowHidesItself("subagent", call("task", {}, { result: "<task_result>ok</task_result>" })),
		).toBe(false);
		expect(soloRowHidesItself("reading", call("read"))).toBe(false);
	});
});
