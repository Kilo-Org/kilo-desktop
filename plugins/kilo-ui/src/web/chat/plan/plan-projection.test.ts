import { describe, expect, it } from "vitest";

import type { Part, ToolPart } from "@assistant-ui/react-opencode";

import {
	findNewestPlanProjection,
	findPlanProjectionByAnchorCallId,
	getPlanProjectionForMessage,
	getPlanProjectionFromParts,
	isCurrentPlanVersion,
	projectPlanThread,
	shouldExcludeToolCallFromActivityGroup,
	type PlanThreadSource,
} from "./plan-projection.js";

const toolPart = (
	tool: string,
	callID: string,
	state:
		| { status: "running"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
		| { status: "completed"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
		| {
				status: "error";
				input: Record<string, unknown>;
				error: string;
				metadata?: Record<string, unknown>;
		  },
): ToolPart => {
	const identity = {
		id: `part-${callID}`,
		sessionID: "session-1",
		messageID: "message-1",
		type: "tool" as const,
		tool,
		callID,
	};
	if (state.status === "running") {
		return {
			...identity,
			state: {
				...state,
				time: { start: 1 },
			},
		};
	}
	if (state.status === "error") {
		return {
			...identity,
			state: {
				...state,
				time: { start: 1, end: 2 },
			},
		};
	}
	return {
		...identity,
		state: {
			...state,
			output: "",
			title: tool,
			metadata: state.metadata ?? {},
			time: { start: 1, end: 2 },
		},
	};
};

const writePart = (
	callID = "write-1",
	input: Record<string, unknown> = {
		filePath: ".kilo/plans/ship.md",
		content: "# Ship it\n\n- step 1",
	},
): ToolPart => toolPart("write", callID, { status: "completed", input });

const editPart = (
	callID = "edit-1",
	input: Record<string, unknown> = {
		filePath: ".kilo/plans/ship.md",
		oldString: "# Ship it",
		newString: "# Ship it faster",
	},
): ToolPart => toolPart("edit", callID, { status: "completed", input });

const exitPart = (
	callID = "exit-1",
	status: "completed" | "error" = "completed",
	plan = ".kilo/plans/ship.md",
): ToolPart =>
	status === "error"
		? toolPart("plan_exit", callID, {
				status: "error",
				input: {},
				error: "Plan file not found",
			})
		: toolPart("plan_exit", callID, {
				status: "completed",
				input: {},
				metadata: { plan },
			});

const threadSource = (
	messages: readonly {
		id: string;
		role: "assistant" | "user";
		agent?: string;
		parts?: readonly Part[];
	}[],
): PlanThreadSource => ({
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(
		messages.map((message) => [
			message.id,
			{
				info: { role: message.role, ...(message.agent ? { agent: message.agent } : {}) },
				parts: message.parts ?? [],
			},
		]),
	),
});

const refinedPlanSource = (): PlanThreadSource =>
	threadSource([
		{ id: "msg-plan", role: "assistant", parts: [writePart(), exitPart()] },
		{ id: "msg-user", role: "user" },
		{
			id: "msg-refine",
			role: "assistant",
			parts: [editPart("edit-2"), exitPart("exit-2")],
		},
	]);

describe("getPlanProjectionFromParts", () => {
	it("projects writing, ready, and error states from typed tool parts", () => {
		const writing = getPlanProjectionFromParts([
			toolPart("write", "write-running", {
				status: "running",
				input: { filePath: ".kilo/plans/ship.md", content: "# Ship" },
			}),
		]);
		expect(writing?.status).toBe("writing");
		expect(writing?.anchorCallId).toBe("write-running");

		const ready = getPlanProjectionFromParts([writePart(), exitPart()]);
		expect(ready?.status).toBe("ready");
		expect(ready?.markdown).toContain("# Ship it");
		expect(ready?.hiddenCallIds).toEqual(new Set(["write-1", "exit-1"]));

		const failed = getPlanProjectionFromParts([writePart(), exitPart("exit-error", "error")]);
		expect(failed?.status).toBe("error");
		expect(failed?.error).toBe("Plan file not found");
	});

	it("ignores non-plan and pathless writes unless the initial draft opts in", () => {
		expect(
			getPlanProjectionFromParts([writePart("write-src", { path: "src/app.ts" })]),
		).toBeUndefined();

		const pending = toolPart("write", "write-pending", { status: "running", input: {} });
		expect(getPlanProjectionFromParts([pending])).toBeUndefined();
		expect(
			getPlanProjectionFromParts([pending], { treatPathlessPendingWritesAsPlan: true })
				?.anchorCallId,
		).toBe("write-pending");
	});

	it("reconstructs edit-only plan revisions from prior markdown", () => {
		const projection = getPlanProjectionFromParts([editPart(), exitPart("exit-2")], {
			priorMarkdown: "# Ship it\n\n- step 1",
		});
		expect(projection?.markdown).toBe("# Ship it faster\n\n- step 1");
		expect(projection?.anchorCallId).toBe("edit-1");
	});

	it("keeps prior markdown when an edit streams without replacement text", () => {
		const projection = getPlanProjectionFromParts(
			[
				editPart("edit-incomplete", {
					filePath: ".kilo/plans/ship.md",
					oldString: "# Ship it",
				}),
			],
			{ priorMarkdown: "# Ship it\n\n- step 1" },
		);

		expect(projection?.markdown).toBe("# Ship it\n\n- step 1");
	});

	it("reports a malformed completed handoff without a path or markdown", () => {
		const projection = getPlanProjectionFromParts([
			toolPart("plan_exit", "exit-empty", { status: "completed", input: {} }),
		]);

		expect(projection?.status).toBe("error");
		expect(projection?.error).toContain("without a plan path or markdown");
	});
});

describe("projectPlanThread", () => {
	it("keeps a plan-agent write projected while its nonstandard path streams", () => {
		const pending = projectPlanThread(
			threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					parts: [toolPart("write", "write-plan", { status: "running", input: {} })],
				},
			]),
		);
		expect(getPlanProjectionForMessage(pending, "msg-plan")?.anchorCallId).toBe("write-plan");

		const writing = projectPlanThread(
			threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					parts: [
						toolPart("write", "write-plan", {
							status: "running",
							input: {
								filePath: "1786491776051-random-coffee-break-plan.md",
								content: "# Random Coffee Break Ritual",
							},
						}),
					],
				},
			]),
		);
		const writingProjection = getPlanProjectionForMessage(writing, "msg-plan");
		expect(writingProjection?.status).toBe("writing");
		expect(writingProjection?.hiddenCallIds).toContain("write-plan");

		const ready = projectPlanThread(
			threadSource([
				{
					id: "msg-write",
					role: "assistant",
					agent: "plan",
					parts: [
						toolPart("write", "write-plan", {
							status: "completed",
							input: {
								filePath: "1786491776051-random-coffee-break-plan.md",
								content: "# Random Coffee Break Ritual",
							},
						}),
					],
				},
				{
					id: "msg-exit",
					role: "assistant",
					agent: "plan",
					parts: [exitPart("exit-plan", "completed", "1786491776051-random-coffee-break-plan.md")],
				},
			]),
		);
		const readyProjection = getPlanProjectionForMessage(ready, "msg-exit");
		expect(readyProjection?.status).toBe("ready");
		expect(readyProjection?.anchorCallId).toBe("write-plan");
		expect(readyProjection?.hiddenCallIds).toEqual(new Set(["write-plan", "exit-plan"]));
		expect(getPlanProjectionForMessage(ready, "msg-write")).toBeUndefined();
	});

	it("projects each message once and enriches chained edits in order", () => {
		const source = threadSource([
			{ id: "msg-plan", role: "assistant", parts: [writePart(), exitPart()] },
			{ id: "msg-user-1", role: "user" },
			{
				id: "msg-refine-1",
				role: "assistant",
				parts: [editPart("edit-a"), exitPart("exit-a")],
			},
			{ id: "msg-user-2", role: "user" },
			{
				id: "msg-refine-2",
				role: "assistant",
				parts: [
					editPart("edit-b", {
						filePath: ".kilo/plans/ship.md",
						oldString: "- step 1",
						newString: "- step 1\n- step 2",
					}),
					exitPart("exit-b"),
				],
			},
		]);
		const projected = projectPlanThread(source);

		expect(getPlanProjectionForMessage(projected, "msg-refine-2")?.markdown).toBe(
			"# Ship it faster\n\n- step 1\n- step 2",
		);
		expect(findNewestPlanProjection(projected)?.anchorCallId).toBe("edit-b");
		expect(projectPlanThread(source)).toBe(projected);
	});

	it("does not classify implementation writes as plans after a completed handoff", () => {
		const projected = projectPlanThread(
			threadSource([
				{ id: "msg-plan", role: "assistant", parts: [writePart(), exitPart()] },
				{ id: "msg-approve", role: "user" },
				{
					id: "msg-implement",
					role: "assistant",
					parts: [toolPart("write", "write-impl", { status: "running", input: {} })],
				},
			]),
		);
		expect(getPlanProjectionForMessage(projected, "msg-implement")).toBeUndefined();
	});

	it("indexes historical and current plan versions", () => {
		const projected = projectPlanThread(refinedPlanSource());

		expect(findPlanProjectionByAnchorCallId(projected, "write-1")?.markdown).toBe(
			"# Ship it\n\n- step 1",
		);
		expect(findPlanProjectionByAnchorCallId(projected, "edit-2")?.markdown).toBe(
			"# Ship it faster\n\n- step 1",
		);
		expect(isCurrentPlanVersion(projected, "write-1")).toBe(false);
		expect(isCurrentPlanVersion(projected, "edit-2")).toBe(true);
	});
});

describe("shouldExcludeToolCallFromActivityGroup", () => {
	it("excludes plan tools by call id, tool name, or plan path", () => {
		expect(shouldExcludeToolCallFromActivityGroup({ toolName: "plan_exit" })).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup({
				toolName: "write",
				args: { filePath: ".kilo/plans/a.md" },
			}),
		).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup(
				{ toolName: "write", toolCallId: "write-pending", args: {} },
				{ hiddenPlanCallIds: new Set(["write-pending"]) },
			),
		).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup({
				toolName: "write",
				args: { filePath: "src/a.ts" },
			}),
		).toBe(false);
	});
});
