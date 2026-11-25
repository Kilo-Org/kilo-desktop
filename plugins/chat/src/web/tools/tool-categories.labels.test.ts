import { afterEach, describe, expect, it } from "vitest";

import {
	activityKindFromGroupKey,
	getActivityKind,
	getGroupKeyForTool,
	getKindMeta,
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

describe("soloRowHidesItself", () => {
	it("hides a quiet successful command but not a failed or cancelled one", () => {
		expect(soloRowHidesItself("terminal", call("shell", {}, { result: "" }))).toBe(true);
		expect(soloRowHidesItself("terminal", call("shell", {}, { result: "out" }))).toBe(false);
		expect(soloRowHidesItself("terminal", call("shell", {}, { result: "Exit code: 1" }))).toBe(
			false,
		);
		expect(soloRowHidesItself("terminal", call("shell", {}, { result: "", isError: true }))).toBe(
			false,
		);
		expect(
			soloRowHidesItself(
				"terminal",
				call("shell", {}, { status: { type: "incomplete", reason: "cancelled" } as never }),
			),
		).toBe(false);
		expect(soloRowHidesItself("terminal", undefined)).toBe(false);
	});

	it("never hides other rows", () => {
		expect(soloRowHidesItself("subagent", call("board_read", {}, { result: "" }))).toBe(false);
		expect(soloRowHidesItself("reading", call("read"))).toBe(false);
	});
});
