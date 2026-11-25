import {
	createOpenCodeThreadState,
	projectOpenCodeThreadMessages,
	reduceOpenCodeThreadState,
	type OpenCodeServerMessage,
	type OpenCodeStateEvent,
	type OpenCodeThreadState,
	type SessionMessageAssistant,
} from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it } from "vitest";

/*
 * Stop status: a stopped turn projects as `incomplete/cancelled` so the
 * transcript says "You stopped" instead of "Worked for" or an error banner.
 */

const assistant = (
	id: string,
	patch: Partial<SessionMessageAssistant> = {},
	content: SessionMessageAssistant["content"] = [],
): OpenCodeServerMessage => ({
	id,
	type: "assistant",
	agent: "code",
	model: { providerID: "provider", id: "model" },
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	time: { created: 2, completed: 10 },
	finish: "stop",
	content,
	...patch,
});

const user = (id: string): OpenCodeServerMessage => ({
	id,
	type: "user",
	text: "go",
	time: { created: 1 },
});

const subagentCall = (id: string, status: "completed" | "error", name = "subagent") =>
	({
		type: "tool",
		id,
		name,
		time: { created: 1, completed: 2 },
		state:
			status === "completed"
				? { status, input: {}, content: [{ type: "text", text: "done" }] }
				: { status, input: {}, error: { type: "cancelled", message: "Task cancelled" } },
	}) as SessionMessageAssistant["content"][number];

const statusOf = (
	messages: readonly OpenCodeServerMessage[],
	overrides: Partial<OpenCodeThreadState> = {},
) => {
	const state: OpenCodeThreadState = {
		...createOpenCodeThreadState("ses_1"),
		sessionStatus: { type: "idle" },
		messageOrder: messages.map((message) => message.id),
		messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
		...overrides,
	};
	return projectOpenCodeThreadMessages(state).at(-1)?.status;
};

describe("projectOpenCodeThreadMessages stop status", () => {
	it("reports a turn stopped mid-step (the step never ended) as stopped, not failed", () => {
		const unfinished = assistant("msg-2", { time: { created: 2 } });
		delete (unfinished as { finish?: unknown }).finish;
		expect(statusOf([user("msg-1"), unfinished])).toEqual({
			type: "incomplete",
			reason: "cancelled",
		});
	});

	it("reports a turn halted between steps as stopped", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { finish: "tool-calls" }, [subagentCall("call-1", "error")]),
		]);

		expect(status).toEqual({ type: "incomplete", reason: "cancelled" });
	});

	it("keeps a tool-call step complete while the run is still going", () => {
		const status = statusOf(
			[
				user("msg-1"),
				assistant("msg-2", { finish: "tool-calls" }, [subagentCall("c", "completed")]),
			],
			{ sessionStatus: { type: "busy" } },
		);

		expect(status).toMatchObject({ type: "complete" });
	});

	it("treats a completed plan_exit as the intended end of a turn", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { finish: "tool-calls" }, [subagentCall("c", "completed", "plan_exit")]),
		]);

		expect(status).toMatchObject({ type: "complete" });
	});

	it("still surfaces genuine errors", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { error: { type: "provider.api", message: "Rate limited" } }),
		]);

		expect(status).toEqual({ type: "incomplete", reason: "error", error: "Rate limited" });
	});
});

describe("reduceOpenCodeThreadState step activity", () => {
	const message = assistant("msg-2", { time: { created: 2 } }, [{ type: "text", text: "a" }]);
	const stateWith = (overrides: Partial<OpenCodeThreadState>): OpenCodeThreadState => ({
		...createOpenCodeThreadState("ses_1"),
		messageOrder: [message.id],
		messagesById: { [message.id]: message },
		...overrides,
	});
	const trailingDelta: OpenCodeStateEvent = {
		type: "kilo.event",
		event: {
			type: "session.text.delta",
			created: 3,
			data: { sessionID: "ses_1", assistantMessageID: message.id, ordinal: 0, delta: "b" },
		} as never,
	};

	it.each(["cancelling", "reverting"] as const)(
		"keeps a %s run from flipping back to streaming on trailing step output",
		(type) => {
			const state = stateWith({ runState: { type } });
			const next = reduceOpenCodeThreadState(state, trailingDelta);

			expect(next.runState).toEqual({ type });
			expect(next.sessionStatus).toBe(state.sessionStatus);
		},
	);

	it("treats step output with an unknown status as a live run", () => {
		const next = reduceOpenCodeThreadState(
			stateWith({ runState: { type: "idle" } }),
			trailingDelta,
		);

		expect(next.runState).toEqual({ type: "streaming" });
		expect(next.sessionStatus).toEqual({ type: "busy" });
	});
});
