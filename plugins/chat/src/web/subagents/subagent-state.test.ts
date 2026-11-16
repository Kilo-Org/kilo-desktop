import { describe, expect, it } from "vitest";
import { createOpenCodeThreadState } from "@assistant-ui/react-opencode";

import {
	childSessionIdForToolCall,
	childSessionIdFromTaskPart,
	delegationStatus,
	selectSubagentTranscript,
	subagentDisplayStatus,
} from "./subagent-state";

describe("subagent state", () => {
	it("reads child identity from both supported metadata locations", () => {
		expect(
			childSessionIdFromTaskPart({
				type: "tool",
				tool: "task",
				state: { metadata: { sessionId: "child-1" } },
			}),
		).toBe("child-1");
		expect(
			childSessionIdFromTaskPart({
				type: "tool",
				tool: "task",
				metadata: { sessionID: "child-2" },
			}),
		).toBe("child-2");
		expect(childSessionIdFromTaskPart({ type: "tool", tool: "read" })).toBeUndefined();
	});

	it("finds a child by tool call and builds stable pane identity", () => {
		expect(
			childSessionIdForToolCall(
				[
					{
						type: "tool",
						tool: "task",
						callID: "call-1",
						state: { metadata: { sessionId: "child-1" } },
					},
				],
				"call-1",
			),
		).toBe("child-1");
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
		expect(
			subagentDisplayStatus({ ...child, sessionStatus: { type: "busy" } }, { type: "complete" }),
		).toBe("working");
		expect(
			subagentDisplayStatus(
				{
					...child,
					interactions: {
						...child.interactions,
						permissions: {
							...child.interactions.permissions,
							pending: { permission: {} as never },
						},
					},
				},
				{ type: "complete" },
			),
		).toBe("waiting");
		const grandchild = {
			...createOpenCodeThreadState("grandchild"),
			interactions: {
				...child.interactions,
				questions: { ...child.interactions.questions, pending: { question: {} as never } },
			},
		};
		expect(
			subagentDisplayStatus({
				...child,
				sessionStatus: { type: "busy" },
				childSessionsById: { grandchild },
			}),
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
	it("follows the live child while it runs, even after its task call returned", () => {
		expect(delegationStatus("working", { type: "complete" })).toBe("working");
		expect(delegationStatus("waiting", { type: "complete" })).toBe("waiting");
	});

	it("reports how the task call ended once the child settles", () => {
		expect(delegationStatus("done", { type: "incomplete", reason: "cancelled" })).toBe("cancelled");
		expect(delegationStatus("done", { type: "incomplete", reason: "error" })).toBe("failed");
		expect(delegationStatus("done", { type: "complete" })).toBe("done");
	});

	it("falls back to the task call before the child session is known", () => {
		expect(delegationStatus(undefined, { type: "running" })).toBe("working");
		expect(delegationStatus(undefined, { type: "complete" })).toBe("done");
	});
});
