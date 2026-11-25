import { describe, expect, it } from "vitest";
import {
	createOpenCodeThreadState,
	type SessionMessageAssistant,
	type SessionMessageAssistantTool,
	type SessionMessageInfo,
} from "@kilo-desktop/react-opencode";

import { assistantMessage, idleMessage, tool, userMessage } from "../../test/kilo2/fixtures";
import {
	findNewestPlanProjection,
	findPlanProjectionByAnchorCallId,
	getPlanProjectionForMessage,
	getPlanProjectionFromTools,
	isCurrentPlanVersion,
	projectPlanThread,
	shouldExcludeToolCallFromActivityGroup,
	type PlanThreadSource,
} from "./plan-projection";

type ToolState =
	| { status: "streaming"; input: string }
	| { status: "running"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
	| { status: "completed"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
	| { status: "error"; input: Record<string, unknown>; error: string };

const toolCall = (name: string, id: string, state: ToolState): SessionMessageAssistantTool => {
	const base = tool(name, {}, "", { id });
	switch (state.status) {
		case "streaming":
			return { ...base, state };
		case "running":
			return {
				...base,
				state: {
					status: "running",
					input: state.input as never,
					metadata: (state.metadata ?? {}) as never,
				},
			};
		case "completed":
			return {
				...base,
				state: {
					status: "completed",
					input: state.input as never,
					content: [{ type: "text", text: "" }],
					metadata: (state.metadata ?? {}) as never,
				},
			};
		case "error":
			return {
				...base,
				state: {
					status: "error",
					input: state.input as never,
					error: { type: "tool", message: state.error },
				},
			};
	}
};

const writeCall = (
	id = "write-1",
	input: Record<string, unknown> = {
		path: ".kilo/plans/ship.md",
		content: "# Ship it\n\n- step 1",
	},
) => toolCall("write", id, { status: "completed", input });

const editCall = (
	id = "edit-1",
	input: Record<string, unknown> = {
		path: ".kilo/plans/ship.md",
		oldString: "# Ship it",
		newString: "# Ship it faster",
	},
) => toolCall("edit", id, { status: "completed", input });

const exitCall = (
	id = "exit-1",
	status: "completed" | "error" = "completed",
	plan = ".kilo/plans/ship.md",
) =>
	status === "error"
		? toolCall("plan_exit", id, { status: "error", input: {}, error: "Plan file not found" })
		: toolCall("plan_exit", id, { status: "completed", input: {}, metadata: { plan } });

/** One model step; `finish` defaults to a finished step that handed off to tools. */
const step = (
	id: string,
	tools: readonly SessionMessageAssistantTool[],
	patch: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => assistantMessage([...tools], { id, finish: "tool-calls", ...patch });

const user = (id: string) => userMessage("go", { id });

const threadSource = (
	messages: readonly SessionMessageInfo[],
	lifecycle: Partial<Pick<PlanThreadSource, "running" | "runState">> = {},
): PlanThreadSource => ({ ...createOpenCodeThreadState("ses_1"), messages, ...lifecycle });

/** A thread still running (so a run without a closing step stays open). */
const running = { running: true, runState: { type: "streaming" } } as const;

const refinedPlanSource = (): PlanThreadSource =>
	threadSource([
		step("msg-plan", [writeCall(), exitCall()]),
		user("msg-user"),
		step("msg-refine", [editCall("edit-2"), exitCall("exit-2")]),
	]);

describe("getPlanProjectionFromTools", () => {
	it("projects writing, ready, and error states from typed tool parts", () => {
		const writing = getPlanProjectionFromTools([
			toolCall("write", "write-running", {
				status: "running",
				input: { path: ".kilo/plans/ship.md", content: "# Ship" },
			}),
		]);
		expect(writing?.status).toBe("writing");
		expect(writing?.anchorCallId).toBe("write-running");

		const ready = getPlanProjectionFromTools([writeCall(), exitCall()]);
		expect(ready?.status).toBe("ready");
		expect(ready?.markdown).toContain("# Ship it");
		expect(ready?.hiddenCallIds).toEqual(new Set(["write-1", "exit-1"]));

		const failed = getPlanProjectionFromTools([writeCall(), exitCall("exit-error", "error")]);
		expect(failed?.status).toBe("error");
		expect(failed?.error).toBe("Plan file not found");
	});

	it("ignores non-plan and pathless writes", () => {
		expect(
			getPlanProjectionFromTools([writeCall("write-src", { path: "src/app.ts" })]),
		).toBeUndefined();

		const pending = toolCall("write", "write-pending", { status: "running", input: {} });
		expect(getPlanProjectionFromTools([pending])).toBeUndefined();
	});

	it("reconstructs edit-only plan revisions from prior markdown", () => {
		const projection = getPlanProjectionFromTools([editCall(), exitCall("exit-2")], {
			priorMarkdown: "# Ship it\n\n- step 1",
		});
		expect(projection?.markdown).toBe("# Ship it faster\n\n- step 1");
		expect(projection?.anchorCallId).toBe("edit-1");
	});

	it("keeps prior markdown when an edit streams without replacement text", () => {
		const projection = getPlanProjectionFromTools(
			[
				editCall("edit-incomplete", {
					path: ".kilo/plans/ship.md",
					oldString: "# Ship it",
				}),
			],
			{ priorMarkdown: "# Ship it\n\n- step 1" },
		);

		expect(projection?.markdown).toBe("# Ship it\n\n- step 1");
	});

	it("reports a malformed completed handoff without a path or markdown", () => {
		const projection = getPlanProjectionFromTools([
			toolCall("plan_exit", "exit-empty", { status: "completed", input: {} }),
		]);

		expect(projection?.status).toBe("error");
		expect(projection?.error).toContain("without a plan path or markdown");
	});
});

describe("projectPlanThread", () => {
	it("does not project a pathless write from the code agent", () => {
		const projected = projectPlanThread(
			threadSource([
				step("msg-code", [toolCall("write", "write-code", { status: "running", input: {} })], {
					agent: "code",
				}),
			]),
		);

		expect(getPlanProjectionForMessage(projected, "msg-code")).toBeUndefined();
	});

	it("keeps a plan-agent write projected while its nonstandard path streams", () => {
		const pending = projectPlanThread(
			threadSource(
				[
					step(
						"msg-plan",
						[toolCall("write", "write-plan", { status: "streaming", input: '{"pa' })],
						{ agent: "plan" },
					),
				],
				running,
			),
		);
		expect(getPlanProjectionForMessage(pending, "msg-plan")?.anchorCallId).toBe("write-plan");

		const nonstandardWrite = {
			path: "1786491776051-random-coffee-break-plan.md",
			content: "# Random Coffee Break Ritual",
		};
		const writing = projectPlanThread(
			threadSource(
				[
					step(
						"msg-plan",
						[toolCall("write", "write-plan", { status: "running", input: nonstandardWrite })],
						{ agent: "plan" },
					),
				],
				running,
			),
		);
		const writingProjection = getPlanProjectionForMessage(writing, "msg-plan");
		expect(writingProjection?.status).toBe("writing");
		expect(writingProjection?.hiddenCallIds).toContain("write-plan");

		const ready = projectPlanThread(
			threadSource([
				step(
					"msg-write",
					[toolCall("write", "write-plan", { status: "completed", input: nonstandardWrite })],
					{ agent: "plan" },
				),
				step(
					"msg-exit",
					[exitCall("exit-plan", "completed", "1786491776051-random-coffee-break-plan.md")],
					{ agent: "plan" },
				),
			]),
		);
		const readyProjection = getPlanProjectionForMessage(ready, "msg-exit");
		expect(readyProjection?.status).toBe("ready");
		expect(readyProjection?.anchorCallId).toBe("write-plan");
		expect(readyProjection?.hiddenCallIds).toEqual(new Set(["write-plan", "exit-plan"]));
		expect(getPlanProjectionForMessage(ready, "msg-write")).toBe(readyProjection);
	});

	it("settles a completed plan write when the assistant run has finished", () => {
		const finishedStep = projectPlanThread(
			threadSource([step("msg-plan", [writeCall()], { agent: "plan", finish: "stop" })], running),
		);
		expect(getPlanProjectionForMessage(finishedStep, "msg-plan")?.status).toBe("ready");

		const idleSession = projectPlanThread(
			threadSource([step("msg-plan", [writeCall()], { agent: "plan" })]),
		);
		expect(getPlanProjectionForMessage(idleSession, "msg-plan")?.status).toBe("ready");

		const endedTurn = projectPlanThread(
			threadSource(
				[step("msg-plan", [writeCall()], { agent: "plan" }), idleMessage("succeeded")],
				running,
			),
		);
		expect(getPlanProjectionForMessage(endedTurn, "msg-plan")?.status).toBe("ready");

		const historicalRun = projectPlanThread(
			threadSource([step("msg-plan", [writeCall()], { agent: "plan" }), user("msg-user")], running),
		);
		expect(getPlanProjectionForMessage(historicalRun, "msg-plan")?.status).toBe("ready");
	});

	it("keeps a completed write in Writing Plan during an active run", () => {
		const projected = projectPlanThread(
			threadSource([step("msg-plan", [writeCall()], { agent: "plan" })], running),
		);

		expect(getPlanProjectionForMessage(projected, "msg-plan")?.status).toBe("writing");
	});

	it("keeps a running session's plan writing between tool-call steps", () => {
		const projected = projectPlanThread(
			threadSource(
				[
					step("msg-plan", [writeCall(), exitCall()], { agent: "plan" }),
					user("msg-user"),
					step("msg-step-1", [editCall("edit-1")], { agent: "plan" }),
					step(
						"msg-step-2",
						[
							editCall("edit-2", {
								path: ".kilo/plans/ship.md",
								oldString: "- step 1",
								newString: "- step 1\n- step 2",
							}),
						],
						{ agent: "plan", finish: "unknown" },
					),
				],
				{ running: true },
			),
		);

		expect(getPlanProjectionForMessage(projected, "msg-step-2")?.status).toBe("writing");
		expect(isCurrentPlanVersion(projected, "write-1")).toBe(false);
	});

	it("settles a run whose last step failed without a finish reason", () => {
		const { finish: _finish, ...failedStep } = step("msg-plan", [writeCall()], {
			agent: "plan",
			error: { type: "aborted", message: "Aborted" },
		});
		const projected = projectPlanThread(threadSource([failedStep], running));

		expect(getPlanProjectionForMessage(projected, "msg-plan")?.status).toBe("ready");
	});

	it("projects each message once and enriches chained edits in order", () => {
		const source = threadSource([
			step("msg-plan", [writeCall(), exitCall()]),
			user("msg-user-1"),
			step("msg-refine-1", [editCall("edit-a"), exitCall("exit-a")]),
			user("msg-user-2"),
			step("msg-refine-2", [
				editCall("edit-b", {
					path: ".kilo/plans/ship.md",
					oldString: "- step 1",
					newString: "- step 1\n- step 2",
				}),
				exitCall("exit-b"),
			]),
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
				step("msg-plan", [writeCall(), exitCall()]),
				user("msg-approve"),
				step("msg-implement", [toolCall("write", "write-impl", { status: "running", input: {} })]),
			]),
		);
		expect(getPlanProjectionForMessage(projected, "msg-implement")).toBeUndefined();
	});

	it("keeps a denied scratch-script write out of the refined plan", () => {
		const denied = "The user has specified a rule which prevents you from using this tool call.";
		const projected = projectPlanThread(
			threadSource([
				step("msg-plan", [writeCall(), exitCall()], { agent: "plan" }),
				user("msg-user"),
				step(
					"msg-refine",
					[
						toolCall("shell", "shell-denied", {
							status: "error",
							input: { command: "curl -sL https://example.test/Ubuntu.terminal | python3 -" },
							error: denied,
						}),
						toolCall("write", "write-script", {
							status: "error",
							input: {
								path: "/var/folders/lz/T/kilo/decode_ubuntu_terminal.py",
								content: "import plistlib\nimport urllib.request\n",
							},
							error: denied,
						}),
						editCall("edit-colors", {
							path: "/repo/.kilo/plans/ship.md",
							oldString: "- step 1",
							newString: "- step 1 with real Ubuntu colors",
						}),
						exitCall("exit-2"),
					],
					{ agent: "plan" },
				),
			]),
		);

		const refined = getPlanProjectionForMessage(projected, "msg-refine");
		expect(refined?.status).toBe("ready");
		expect(refined?.markdown).toBe("# Ship it\n\n- step 1 with real Ubuntu colors");
		expect(refined?.hiddenCallIds).not.toContain("write-script");
	});

	it("ignores a failed edit to the plan file and keeps the plan ready", () => {
		const projection = getPlanProjectionFromTools(
			[
				writeCall(),
				toolCall("edit", "edit-failed", {
					status: "error",
					input: { path: ".kilo/plans/ship.md", oldString: "# Ship it", newString: "# Dropped" },
					error: "File changed since it was last read",
				}),
				editCall("edit-applied", {
					path: ".kilo/plans/ship.md",
					oldString: "- step 1",
					newString: "- step 1\n- step 2",
				}),
				exitCall("exit-2"),
			],
			{ treatWritesAsPlan: true },
		);

		expect(projection?.status).toBe("ready");
		expect(projection?.markdown).toBe("# Ship it\n\n- step 1\n- step 2");
		expect(projection?.hiddenCallIds).not.toContain("edit-failed");
	});

	it("only treats writes to the file plan_exit names as the plan", () => {
		const projection = getPlanProjectionFromTools(
			[
				writeCall(),
				writeCall("write-notes", { path: "docs/notes.md", content: "# Scratch notes" }),
				exitCall("exit-1"),
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
				step(
					"msg-plan",
					[writeCall("write-script", { path: "scripts/fetch.py", content: "import requests" })],
					{ agent: "plan", finish: "stop" },
				),
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

	it("excludes task-list calls", () => {
		expect(shouldExcludeToolCallFromActivityGroup({ toolName: "todowrite" })).toBe(true);
	});
});
