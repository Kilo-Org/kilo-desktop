import { describe, expect, it } from "vitest";

import { projectOpenCodeThreadMessages } from "./openCodeMessageProjection";
import { assistant, idle, streamingAssistant, text, threadState, tool, user } from "./testUtils";
import type { OpenCodeThreadState, Transcript } from "./types";

/*
 * Stop status (requirement R8 in docs/kilo-v2.md): a stopped turn projects as
 * `incomplete/cancelled` so the transcript says "You stopped" instead of
 * "Worked for" or an error banner.
 */

const statusOf = (messages: Transcript, overrides: Partial<OpenCodeThreadState> = {}) =>
	projectOpenCodeThreadMessages(threadState(messages, overrides)).at(-1)?.status;

const CANCELLED = { type: "incomplete", reason: "cancelled" };

describe("projectOpenCodeThreadMessages stop status", () => {
	it("reports an interrupted turn as stopped, not failed", () => {
		expect(
			statusOf([
				user("msg_1"),
				assistant("msg_2", [text("Partial")]),
				idle("msg_3", "interrupted"),
			]),
		).toEqual(CANCELLED);
	});

	it("reports a step that never finished once the run is over as stopped", () => {
		expect(statusOf([user("msg_1"), streamingAssistant("msg_2", [text("Partial")])])).toEqual(
			CANCELLED,
		);
	});

	it("reports a turn halted between steps, its last step handing off to tools, as stopped", () => {
		expect(statusOf([user("msg_1"), assistant("msg_2", [tool("call_1", "subagent")])])).toEqual(
			CANCELLED,
		);
	});

	it("keeps a turn running while the session runs, even between steps", () => {
		expect(
			statusOf([user("msg_1"), assistant("msg_2", [tool("call_1", "read")])], { running: true }),
		).toEqual({ type: "running" });
	});

	it("treats a completed plan_exit as the intended end of a turn", () => {
		expect(
			statusOf([
				user("msg_1"),
				assistant("msg_2", [tool("call_1", "plan_exit", {}, "Plan ready")]),
			]),
		).toEqual({
			type: "complete",
			reason: "stop",
		});
	});

	it("keeps a turn that ended on tool calls complete once its idle message says it succeeded", () => {
		expect(
			statusOf([
				user("msg_1"),
				assistant("msg_2", [tool("call_1", "read")]),
				idle("msg_3", "succeeded"),
			]),
		).toEqual({ type: "complete", reason: "stop" });
	});

	it("keeps an earlier turn that ended on tool calls complete", () => {
		const messages = projectOpenCodeThreadMessages(
			threadState([
				user("msg_1"),
				assistant("msg_2", [tool("call_1", "read")]),
				user("msg_3"),
				assistant("msg_4", [text("Done")]),
			]),
		);

		expect(messages[1]?.status).toEqual({ type: "complete", reason: "stop" });
	});

	it("still surfaces genuine errors", () => {
		expect(
			statusOf([
				user("msg_1"),
				assistant("msg_2", [], {
					finish: "error",
					error: { type: "api", message: "Rate limited" },
				}),
				idle("msg_3", "failed"),
			]),
		).toEqual({ type: "incomplete", reason: "error", error: "Rate limited" });
	});
});
