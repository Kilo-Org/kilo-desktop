import { describe, expect, it } from "vitest";
import { createOpenCodeThreadState } from "@kilo-desktop/react-opencode";

import {
	assistantMessage,
	permissionRequest,
	questionForm,
	tool,
	userMessage,
} from "../../test/kilo2/fixtures";
import {
	delegationStatus,
	selectSubagentTranscript,
	subagentAgent,
	subagentCallForChild,
	subagentDisplayStatus,
	subagentTaskTitle,
} from "./subagent-state";

const subagentCall = (childSessionId: string | undefined, input: Record<string, unknown>) => {
	const call = tool("subagent", input, "done");
	return childSessionId
		? { ...call, state: { ...call.state, metadata: { sessionID: childSessionId } } }
		: call;
};

describe("subagent state", () => {
	it("reads a delegation's title and agent from the subagent call's input", () => {
		const call = subagentCall("ses_child", {
			agent: "code-reviewer",
			description: "  Review   the diff ",
			prompt: "Look at everything",
		});
		expect(subagentTaskTitle(call)).toBe("Review the diff");
		expect(subagentAgent(call)).toBe("code-reviewer");
		expect(subagentTaskTitle(subagentCall("ses_child", { prompt: "Only a prompt" }))).toBe(
			"Only a prompt",
		);
	});

	it("finds the subagent call that runs a child session", () => {
		const call = subagentCall("ses_child", { agent: "explore", description: "Explore" });
		const messages = [
			userMessage("go"),
			assistantMessage([tool("read", { path: "a.ts" }), subagentCall(undefined, {}), call]),
		];
		expect(subagentCallForChild(messages, "ses_child")).toBe(call);
		expect(subagentCallForChild(messages, "ses_other")).toBeUndefined();
	});

	it("distinguishes loading, unavailable, error, and ready transcripts", () => {
		const parent = {
			...createOpenCodeThreadState("parent"),
			loadState: { type: "ready" as const },
		};
		expect(selectSubagentTranscript(undefined, "child")).toEqual({ type: "loading" });
		expect(selectSubagentTranscript(parent, "child")).toEqual({ type: "unavailable" });
		expect(
			selectSubagentTranscript(
				{ ...parent, loadState: { type: "error", error: new Error("failed") } },
				"child",
			),
		).toEqual({ type: "error" });

		const errorChild = {
			...createOpenCodeThreadState("child"),
			loadState: { type: "error" as const, error: new Error("failed") },
		};
		expect(
			selectSubagentTranscript({ ...parent, childSessionsById: { child: errorChild } }, "child"),
		).toEqual({ type: "error" });

		const readyChild = {
			...createOpenCodeThreadState("child"),
			loadState: { type: "ready" as const },
		};
		expect(
			selectSubagentTranscript({ ...parent, childSessionsById: { child: readyChild } }, "child"),
		).toMatchObject({ type: "ready", messages: [] });
	});

	it("prefers live child lifecycle over the parent tool status", () => {
		const child = createOpenCodeThreadState("child");
		expect(subagentDisplayStatus({ ...child, running: true }, { type: "complete" })).toBe(
			"working",
		);
		expect(
			subagentDisplayStatus(
				{
					...child,
					interactions: {
						...child.interactions,
						permissions: {
							...child.interactions.permissions,
							pending: { per_1: permissionRequest("child", { action: "shell" }) },
						},
					},
				},
				{ type: "complete" },
			),
		).toBe("waiting");
		const form = questionForm("grandchild", [{ question: "Which?", header: "Pick", options: [] }]);
		const grandchild = {
			...createOpenCodeThreadState("grandchild"),
			interactions: {
				...child.interactions,
				questions: { ...child.interactions.questions, pending: { [form.id]: form } },
			},
		};
		expect(
			subagentDisplayStatus({ ...child, running: true, childSessionsById: { grandchild } }),
		).toBe("waiting");
		expect(subagentDisplayStatus(undefined, { type: "incomplete", reason: "cancelled" })).toBe(
			"cancelled",
		);
		expect(
			subagentDisplayStatus(
				{ ...child, runState: { type: "cancelling" } },
				{ type: "incomplete", reason: "cancelled" },
			),
		).toBe("working");
	});
});

describe("delegationStatus", () => {
	it("follows the live child while it runs, even after its subagent call returned", () => {
		expect(delegationStatus("working", { type: "complete" })).toBe("working");
		expect(delegationStatus("waiting", { type: "complete" })).toBe("waiting");
	});

	it("reports how the subagent call ended once the child settles", () => {
		expect(delegationStatus("done", { type: "incomplete", reason: "cancelled" })).toBe("cancelled");
		expect(delegationStatus("done", { type: "incomplete", reason: "error" })).toBe("failed");
		expect(delegationStatus("done", { type: "complete" })).toBe("done");
	});

	it("falls back to the subagent call before the child session is known", () => {
		expect(delegationStatus(undefined, { type: "running" })).toBe("working");
		expect(delegationStatus(undefined, { type: "complete" })).toBe("done");
	});
});
