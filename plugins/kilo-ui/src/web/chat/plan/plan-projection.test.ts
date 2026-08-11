import { describe, expect, it } from "vitest";

import {
	findNewestPlanProjection,
	findPlanProjectionByAnchorCallId,
	findPriorPlanMarkdown,
	getPlanProjectionForMessage,
	getPlanProjectionFromParts,
	isCurrentPlanVersion,
	shouldExcludeToolCallFromActivityGroup,
} from "./plan-projection.js";

const writePart = (overrides: Record<string, unknown> = {}) => ({
	type: "tool",
	tool: "write",
	callID: "write-1",
	state: {
		status: "completed",
		input: {
			filePath: ".kilo/plans/ship.md",
			content: "# Ship it\n\n- step 1",
		},
		...((overrides.state as object) ?? {}),
	},
	...overrides,
});

const editPart = (overrides: Record<string, unknown> = {}) => ({
	type: "tool",
	tool: "edit",
	callID: "edit-1",
	state: {
		status: "completed",
		input: {
			filePath: ".kilo/plans/ship.md",
			oldString: "# Ship it",
			newString: "# Ship it faster",
		},
		...((overrides.state as object) ?? {}),
	},
	...overrides,
});

const exitPart = (overrides: Record<string, unknown> = {}) => ({
	type: "tool",
	tool: "plan_exit",
	callID: "exit-1",
	state: {
		status: "completed",
		input: {},
		metadata: { plan: ".kilo/plans/ship.md" },
		...((overrides.state as object) ?? {}),
	},
	...overrides,
});

describe("getPlanProjectionFromParts", () => {
	it("returns writing while a plan file write is in progress", () => {
		const projection = getPlanProjectionFromParts([
			writePart({
				state: {
					status: "running",
					input: {
						filePath: ".kilo/plans/ship.md",
						content: "# Ship",
					},
				},
			}),
		]);
		expect(projection?.status).toBe("writing");
		expect(projection?.anchorCallId).toBe("write-1");
		expect(projection?.hiddenCallIds.has("write-1")).toBe(true);
	});

	it("returns ready after plan_exit completes", () => {
		const projection = getPlanProjectionFromParts([writePart(), exitPart()]);
		expect(projection?.status).toBe("ready");
		expect(projection?.path).toBe(".kilo/plans/ship.md");
		expect(projection?.markdown).toContain("# Ship it");
		expect(projection?.anchorCallId).toBe("write-1");
		expect(projection?.hiddenCallIds.has("exit-1")).toBe(true);
	});

	it("ignores non-plan writes", () => {
		expect(
			getPlanProjectionFromParts([
				{
					type: "tool",
					tool: "write",
					callID: "write-src",
					state: {
						status: "completed",
						input: { filePath: "src/app.ts", content: " cons x = 1" },
					},
				},
			]),
		).toBeUndefined();
	});

	it("reports error when plan_exit fails", () => {
		const projection = getPlanProjectionFromParts([
			writePart(),
			exitPart({
				state: {
					status: "error",
					error: "Plan file not found",
					input: {},
				},
			}),
		]);
		expect(projection?.status).toBe("error");
		expect(projection?.error).toBe("Plan file not found");
	});

	it("reconstructs markdown when a follow-up edit patches the plan title", () => {
		const projection = getPlanProjectionFromParts([writePart(), editPart(), exitPart()]);
		expect(projection?.status).toBe("ready");
		expect(projection?.markdown).toBe("# Ship it faster\n\n- step 1");
		expect(projection?.anchorCallId).toBe("edit-1");
	});

	it("applies prior markdown when the latest turn only edits the plan file", () => {
		const projection = getPlanProjectionFromParts([editPart(), exitPart({ callID: "exit-2" })], {
			priorMarkdown: "# Ship it\n\n- step 1",
		});
		expect(projection?.status).toBe("ready");
		expect(projection?.markdown).toBe("# Ship it faster\n\n- step 1");
		expect(projection?.path).toBe(".kilo/plans/ship.md");
	});

	it("returns empty markdown for edit-only turns without prior content", () => {
		const projection = getPlanProjectionFromParts([editPart(), exitPart({ callID: "exit-2" })]);
		expect(projection?.status).toBe("ready");
		expect(projection?.markdown).toBe("");
		expect(projection?.path).toBe(".kilo/plans/ship.md");
	});
});

describe("shouldExcludeToolCallFromActivityGroup", () => {
	it("excludes plan_exit and plan-file writes", () => {
		expect(shouldExcludeToolCallFromActivityGroup({ toolName: "plan_exit" })).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup({
				toolName: "write",
				args: { filePath: ".kilo/plans/a.md" },
			}),
		).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup({
				toolName: "write",
				args: { filePath: "src/a.ts" },
			}),
		).toBe(false);
	});

	it("excludes projected plan tools even when args have no path yet", () => {
		const projection = getPlanProjectionFromParts([
			{
				type: "tool",
				tool: "write",
				callID: "write-pending",
				state: { status: "running", input: {} },
			},
		]);
		expect(projection?.hiddenCallIds.has("write-pending")).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup(
				{ toolName: "write", toolCallId: "write-pending", args: {} },
				{ hiddenPlanCallIds: projection?.hiddenCallIds },
			),
		).toBe(true);
		expect(
			shouldExcludeToolCallFromActivityGroup(
				{ toolName: "write", toolCallId: "write-other", args: {} },
				{ hiddenPlanCallIds: projection?.hiddenCallIds },
			),
		).toBe(false);
	});
});

describe("getPlanProjectionForMessage", () => {
	it("enriches edit-only follow-ups with markdown from earlier plan writes", () => {
		const messages = [
			{
				id: "msg-1",
				role: "assistant",
				metadata: {
					custom: { opencode: { parts: [writePart(), exitPart()] } },
				},
			},
			{ id: "msg-user", role: "user", metadata: {} },
			{
				id: "msg-2",
				role: "assistant",
				metadata: {
					custom: {
						opencode: {
							parts: [editPart({ callID: "edit-2" }), exitPart({ callID: "exit-2" })],
						},
					},
				},
			},
		];
		const projection = getPlanProjectionForMessage(messages, "msg-2");
		expect(projection?.markdown).toBe("# Ship it faster\n\n- step 1");
		expect(projection?.status).toBe("ready");
		expect(projection?.anchorCallId).toBe("edit-2");
	});
});

describe("findNewestPlanProjection", () => {
	it("returns the newest plan even when a user message follows an older plan", () => {
		const projection = findNewestPlanProjection([
			{
				role: "assistant",
				metadata: {
					custom: { opencode: { parts: [writePart(), exitPart()] } },
				},
			},
			{ role: "user", metadata: {} },
			{
				role: "assistant",
				metadata: {
					custom: {
						opencode: {
							parts: [editPart({ callID: "edit-2" }), exitPart({ callID: "exit-2" })],
						},
					},
				},
			},
		]);
		expect(projection?.anchorCallId).toBe("edit-2");
		expect(projection?.markdown).toBe("# Ship it faster\n\n- step 1");
	});

	it("keeps the prior plan when the latest message is a user refine", () => {
		const projection = findNewestPlanProjection([
			{
				role: "assistant",
				metadata: {
					custom: { opencode: { parts: [writePart(), exitPart()] } },
				},
			},
			{ role: "user", metadata: {} },
		]);
		expect(projection?.anchorCallId).toBe("write-1");
		expect(projection?.markdown).toContain("# Ship it");
	});
});

describe("findPlanProjectionByAnchorCallId", () => {
	it("returns the historical snapshot for an older plan card after refinement", () => {
		const messages = [
			{
				role: "assistant",
				metadata: {
					custom: { opencode: { parts: [writePart(), exitPart()] } },
				},
			},
			{ role: "user", metadata: {} },
			{
				role: "assistant",
				metadata: {
					custom: {
						opencode: {
							parts: [editPart({ callID: "edit-2" }), exitPart({ callID: "exit-2" })],
						},
					},
				},
			},
		] as const;

		const older = findPlanProjectionByAnchorCallId(messages, "write-1");
		expect(older?.markdown).toBe("# Ship it\n\n- step 1");
		expect(older?.anchorCallId).toBe("write-1");

		const newer = findPlanProjectionByAnchorCallId(messages, "edit-2");
		expect(newer?.markdown).toBe("# Ship it faster\n\n- step 1");
	});
});

describe("isCurrentPlanVersion", () => {
	it("is false for superseded plan anchors", () => {
		const messages = [
			{
				role: "assistant",
				metadata: {
					custom: { opencode: { parts: [writePart(), exitPart()] } },
				},
			},
			{ role: "user", metadata: {} },
			{
				role: "assistant",
				metadata: {
					custom: {
						opencode: {
							parts: [editPart({ callID: "edit-2" }), exitPart({ callID: "exit-2" })],
						},
					},
				},
			},
		] as const;

		expect(isCurrentPlanVersion(messages, "write-1")).toBe(false);
		expect(isCurrentPlanVersion(messages, "edit-2")).toBe(true);
	});
});

describe("findPriorPlanMarkdown", () => {
	it("returns the latest matching plan markdown before the current turn", () => {
		expect(
			findPriorPlanMarkdown(
				[
					{
						role: "assistant",
						metadata: {
							custom: { opencode: { parts: [writePart(), exitPart()] } },
						},
					},
					{ role: "user", metadata: {} },
				],
				".kilo/plans/ship.md",
			),
		).toBe("# Ship it\n\n- step 1");
	});

	it("applies chained edit follow-ups in order", () => {
		expect(
			findPriorPlanMarkdown(
				[
					{
						role: "assistant",
						metadata: {
							custom: { opencode: { parts: [writePart(), exitPart()] } },
						},
					},
					{ role: "user", metadata: {} },
					{
						role: "assistant",
						metadata: {
							custom: {
								opencode: {
									parts: [editPart({ callID: "edit-a" }), exitPart({ callID: "exit-a" })],
								},
							},
						},
					},
					{ role: "user", metadata: {} },
					{
						role: "assistant",
						metadata: {
							custom: {
								opencode: {
									parts: [
										editPart({
											callID: "edit-b",
											state: {
												status: "completed",
												input: {
													filePath: ".kilo/plans/ship.md",
													oldString: "- step 1",
													newString: "- step 1\n- step 2",
												},
											},
										}),
										exitPart({ callID: "exit-b" }),
									],
								},
							},
						},
					},
				],
				".kilo/plans/ship.md",
			),
		).toBe("# Ship it faster\n\n- step 1\n- step 2");
	});
});
