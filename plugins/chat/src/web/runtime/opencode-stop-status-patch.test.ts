import {
	createOpenCodeThreadState,
	projectOpenCodeThreadMessages,
	reduceOpenCodeThreadState,
	type OpenCodeServerMessage,
	type OpenCodeThreadState,
} from "@kilo-desktop/react-opencode";
import { describe, expect, it } from "vitest";

/*
 * Stop status in kilo.chat's react-opencode fork
 * (plugins/chat/react-opencode): a stopped turn projects as
 * `incomplete/cancelled` so the transcript says "You stopped" instead of
 * "Worked for" or an error banner.
 */

const assistant = (
	id: string,
	info: Record<string, unknown>,
	parts: Array<Record<string, unknown>> = [],
): OpenCodeServerMessage => ({
	id,
	info: {
		id,
		role: "assistant",
		sessionID: "ses_1",
		modelID: "model",
		providerID: "provider",
		mode: "primary",
		path: { cwd: "/", root: "/" },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: Number(id.split("-")[1] ?? 1), completed: 10 },
		...info,
	} as never,
	parts: parts as never,
	shadowParts: undefined,
});

const user = (id: string): OpenCodeServerMessage => ({
	id,
	info: {
		id,
		role: "user",
		sessionID: "ses_1",
		time: { created: Number(id.split("-")[1] ?? 1) },
	} as never,
	parts: [{ id: `${id}_1`, sessionID: "ses_1", messageID: id, type: "text", text: "go" }] as never,
	shadowParts: undefined,
});

const taskPart = (id: string, status: string) => ({
	id,
	sessionID: "ses_1",
	messageID: "msg-2",
	type: "tool",
	tool: "task",
	callID: `call-${id}`,
	state: { status, input: {}, error: "Task cancelled", time: { start: 1, end: 2 } },
});

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
	it("reports a turn aborted mid-step as stopped, not failed", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { error: { name: "MessageAbortedError", data: { message: "Aborted" } } }),
		]);

		expect(status).toEqual({ type: "incomplete", reason: "cancelled" });
	});

	it("reports a turn halted between steps as stopped", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { finish: "tool-calls" }, [taskPart("prt-1", "error")]),
		]);

		expect(status).toEqual({ type: "incomplete", reason: "cancelled" });
	});

	it("keeps a tool-call step complete while the run is still going", () => {
		const status = statusOf(
			[
				user("msg-1"),
				assistant("msg-2", { finish: "tool-calls" }, [taskPart("prt-1", "completed")]),
			],
			{ sessionStatus: { type: "busy" } },
		);

		expect(status).toMatchObject({ type: "complete" });
	});

	it("treats a completed plan_exit as the intended end of a turn", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { finish: "tool-calls" }, [
				{ ...taskPart("prt-1", "completed"), tool: "plan_exit" },
			]),
		]);

		expect(status).toMatchObject({ type: "complete" });
	});

	it("still surfaces genuine errors", () => {
		const status = statusOf([
			user("msg-1"),
			assistant("msg-2", { error: { name: "APIError", data: { message: "Rate limited" } } }),
		]);

		expect(status).toEqual({ type: "incomplete", reason: "error", error: "Rate limited" });
	});
});

describe("reduceOpenCodeThreadState part activity", () => {
	const message = assistant("msg-2", {}, [taskPart("prt-1", "completed")]);
	const stateWith = (overrides: Partial<OpenCodeThreadState>): OpenCodeThreadState => ({
		...createOpenCodeThreadState("ses_1"),
		messageOrder: [message.id],
		messagesById: { [message.id]: message },
		...overrides,
	});
	const trailingPart = {
		type: "part.updated",
		messageId: message.id,
		part: taskPart("prt-1", "completed"),
	} as never;

	it.each(["cancelling", "reverting"] as const)(
		"keeps a %s run from flipping back to streaming on trailing part output",
		(type) => {
			const state = stateWith({ runState: { type } });
			const next = reduceOpenCodeThreadState(state, trailingPart);

			expect(next.runState).toEqual({ type });
			expect(next.sessionStatus).toBe(state.sessionStatus);
		},
	);

	it("treats part output with an unknown status as a live run", () => {
		const next = reduceOpenCodeThreadState(stateWith({ runState: { type: "idle" } }), trailingPart);

		expect(next.runState).toEqual({ type: "streaming" });
		expect(next.sessionStatus).toEqual({ type: "busy" });
	});
});
