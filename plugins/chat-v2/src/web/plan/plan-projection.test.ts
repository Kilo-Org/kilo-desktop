import { describe, expect, it } from "vitest";

import type {
	KiloAssistantContent,
	KiloToolCall,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode-v2";

import {
	findNewestPlanProjection,
	findPlanProjectionByAnchorCallId,
	getPlanProjectionForMessage,
	getPlanProjectionFromParts,
	isCurrentPlanVersion,
	projectPlanThread,
	shouldExcludeToolCallFromActivityGroup,
	type PlanThreadSource,
} from "./plan-projection";

type Part = KiloAssistantContent;
type ToolPart = KiloToolCall;

const toolPart = (
	name: string,
	id: string,
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
	const identity = { type: "tool" as const, id, name, time: { created: 1 } };
	if (state.status === "running") {
		return { ...identity, state: { ...state, metadata: state.metadata ?? {} } } as ToolPart;
	}
	if (state.status === "error") {
		return {
			...identity,
			state: { ...state, error: { type: "tool", message: state.error } },
		} as ToolPart;
	}
	return {
		...identity,
		state: { ...state, content: [{ type: "text", text: "" }], metadata: state.metadata ?? {} },
	} as ToolPart;
};

const writePart = (
	callID = "write-1",
	input: Record<string, unknown> = {
		path: ".kilo/plans/ship.md",
		content: "# Ship it\n\n- step 1",
	},
): ToolPart => toolPart("write", callID, { status: "completed", input });

const editPart = (
	callID = "edit-1",
	input: Record<string, unknown> = {
		path: ".kilo/plans/ship.md",
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
		finish?: string;
		error?: unknown;
		parts?: readonly Part[];
	}[],
): PlanThreadSource => ({
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(
		messages.map((message): [string, SessionMessageInfo] => [
			message.id,
			message.role === "user"
				? { id: message.id, type: "user", text: "next", time: { created: 1 } }
				: ({
						id: message.id,
						type: "assistant",
						agent: message.agent ?? "code",
						model: { providerID: "kilo", id: "m" },
						time: { created: 1 },
						content: [...(message.parts ?? [])],
						...(message.finish ? { finish: message.finish } : {}),
						...(message.error ? { error: message.error } : {}),
					} as SessionMessageInfo),
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
				input: { path: ".kilo/plans/ship.md", content: "# Ship" },
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

	it("ignores non-plan and pathless writes", () => {
		expect(
			getPlanProjectionFromParts([writePart("write-src", { path: "src/app.ts" })]),
		).toBeUndefined();

		const pending = toolPart("write", "write-pending", { status: "running", input: {} });
		expect(getPlanProjectionFromParts([pending])).toBeUndefined();
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
					path: ".kilo/plans/ship.md",
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
	it("does not project a pathless write from the code agent", () => {
		const projected = projectPlanThread(
			threadSource([
				{
					id: "msg-code",
					role: "assistant",
					agent: "code",
					parts: [toolPart("write", "write-code", { status: "running", input: {} })],
				},
			]),
		);

		expect(getPlanProjectionForMessage(projected, "msg-code")).toBeUndefined();
	});

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
								path: "1786491776051-random-coffee-break-plan.md",
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
								path: "1786491776051-random-coffee-break-plan.md",
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
		expect(getPlanProjectionForMessage(ready, "msg-write")).toBe(readyProjection);
	});

	it("settles a completed plan write when the assistant run has finished", () => {
		const finishedMessage = projectPlanThread(
			threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					finish: "stop",
					parts: [writePart()],
				},
			]),
		);
		expect(getPlanProjectionForMessage(finishedMessage, "msg-plan")?.status).toBe("ready");

		const restoredIdleRun = projectPlanThread({
			...threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					parts: [writePart()],
				},
			]),
			runState: { type: "idle" },
			sessionStatus: { type: "idle" },
		});
		expect(getPlanProjectionForMessage(restoredIdleRun, "msg-plan")?.status).toBe("ready");

		const historicalRun = projectPlanThread(
			threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					parts: [writePart()],
				},
				{ id: "msg-user", role: "user" },
			]),
		);
		expect(getPlanProjectionForMessage(historicalRun, "msg-plan")?.status).toBe("ready");
	});

	it("keeps a completed write in Writing Plan during an active run", () => {
		const projected = projectPlanThread({
			...threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					parts: [writePart()],
				},
			]),
			runState: { type: "streaming" },
			sessionStatus: { type: "busy" },
		});

		expect(getPlanProjectionForMessage(projected, "msg-plan")?.status).toBe("writing");
	});

	it("keeps a busy run's plan writing between tool-call steps", () => {
		const projected = projectPlanThread({
			...threadSource([
				{ id: "msg-plan", role: "assistant", agent: "plan", parts: [writePart(), exitPart()] },
				{ id: "msg-user", role: "user" },
				{
					id: "msg-step-1",
					role: "assistant",
					agent: "plan",
					finish: "tool-calls",
					parts: [editPart("edit-1")],
				},
				{
					id: "msg-step-2",
					role: "assistant",
					agent: "plan",
					finish: "unknown",
					parts: [
						editPart("edit-2", {
							path: ".kilo/plans/ship.md",
							oldString: "- step 1",
							newString: "- step 1\n- step 2",
						}),
					],
				},
			]),
			sessionStatus: { type: "busy" },
		});

		expect(getPlanProjectionForMessage(projected, "msg-step-2")?.status).toBe("writing");
		expect(isCurrentPlanVersion(projected, "write-1")).toBe(false);
	});

	it("settles a run whose last step failed without a finish reason", () => {
		const projected = projectPlanThread({
			...threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					error: { name: "MessageAbortedError" },
					parts: [writePart()],
				},
			]),
			sessionStatus: { type: "busy" },
		});

		expect(getPlanProjectionForMessage(projected, "msg-plan")?.status).toBe("ready");
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
						path: ".kilo/plans/ship.md",
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

	it("keeps a denied scratch-script write out of the refined plan", () => {
		const projected = projectPlanThread(
			threadSource([
				{ id: "msg-plan", role: "assistant", agent: "plan", parts: [writePart(), exitPart()] },
				{ id: "msg-user", role: "user" },
				{
					id: "msg-refine",
					role: "assistant",
					agent: "plan",
					parts: [
						toolPart("shell", "shell-denied", {
							status: "error",
							input: { command: "curl -sL https://example.test/Ubuntu.terminal | python3 -" },
							error: "The user has specified a rule which prevents you from using this tool call.",
						}),
						toolPart("write", "write-script", {
							status: "error",
							input: {
								path: "/var/folders/lz/T/kilo/decode_ubuntu_terminal.py",
								content: "import plistlib\nimport urllib.request\n",
							},
							error: "The user has specified a rule which prevents you from using this tool call.",
						}),
						editPart("edit-colors", {
							path: "/repo/.kilo/plans/ship.md",
							oldString: "- step 1",
							newString: "- step 1 with real Ubuntu colors",
						}),
						exitPart("exit-2"),
					],
				},
			]),
		);

		const refined = getPlanProjectionForMessage(projected, "msg-refine");
		expect(refined?.status).toBe("ready");
		expect(refined?.markdown).toBe("# Ship it\n\n- step 1 with real Ubuntu colors");
		expect(refined?.hiddenCallIds).not.toContain("write-script");
	});

	it("ignores a failed edit to the plan file and keeps the plan ready", () => {
		const projection = getPlanProjectionFromParts(
			[
				writePart(),
				toolPart("edit", "edit-failed", {
					status: "error",
					input: {
						path: ".kilo/plans/ship.md",
						oldString: "# Ship it",
						newString: "# Dropped",
					},
					error: "File changed since it was last read",
				}),
				editPart("edit-applied", {
					path: ".kilo/plans/ship.md",
					oldString: "- step 1",
					newString: "- step 1\n- step 2",
				}),
				exitPart("exit-2"),
			],
			{ treatWritesAsPlan: true },
		);

		expect(projection?.status).toBe("ready");
		expect(projection?.markdown).toBe("# Ship it\n\n- step 1\n- step 2");
		expect(projection?.hiddenCallIds).not.toContain("edit-failed");
	});

	it("only treats writes to the file plan_exit names as the plan", () => {
		const projection = getPlanProjectionFromParts(
			[
				writePart(),
				writePart("write-notes", { path: "docs/notes.md", content: "# Scratch notes" }),
				exitPart("exit-1"),
			],
			{ treatWritesAsPlan: true },
		);

		expect(projection?.path).toBe(".kilo/plans/ship.md");
		expect(projection?.markdown).toBe("# Ship it\n\n- step 1");
		expect(projection?.anchorCallId).toBe("write-1");
		expect(projection?.hiddenCallIds).not.toContain("write-notes");
	});

	it("does not project a plan-agent script write before the handoff", () => {
		const projected = projectPlanThread(
			threadSource([
				{
					id: "msg-plan",
					role: "assistant",
					agent: "plan",
					finish: "stop",
					parts: [
						writePart("write-script", { path: "scripts/fetch.py", content: "import requests" }),
					],
				},
			]),
		);

		expect(getPlanProjectionForMessage(projected, "msg-plan")).toBeUndefined();
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
				args: { path: ".kilo/plans/a.md" },
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
				args: { path: "src/a.ts" },
			}),
		).toBe(false);
	});

	it("excludes task-list lifecycle calls", () => {
		expect(shouldExcludeToolCallFromActivityGroup({ toolName: "todowrite" })).toBe(true);
	});
});
