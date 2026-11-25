import type { SessionMessageAssistant, SessionMessageInfo } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import {
	applyTranscriptEvent,
	applyTranscriptEvents,
	messageIdFromEvent,
	type KiloEventFrame,
	type Transcript,
} from "./kiloTranscript";
import { assistant, MODEL, streamingAssistant, text, tool, user, ZERO_TOKENS } from "./testUtils";

const event = (
	type: string,
	data: Record<string, unknown> = {},
	id = "evt_1",
	created = 500,
): KiloEventFrame => ({
	id,
	created,
	type,
	data: { sessionID: "ses_1", ...data },
});

const step = (assistantMessageID: string, started = 100) =>
	event("session.step.started", { assistantMessageID, agent: "code", model: MODEL, started });

const onStep = (type: string, data: Record<string, unknown> = {}) =>
	event(type, { assistantMessageID: "msg_a", ...data });

const assistantOf = (messages: Transcript, id = "msg_a") =>
	messages.find(
		(message): message is SessionMessageAssistant =>
			message.id === id && message.type === "assistant",
	);

const contentOf = (messages: Transcript, id = "msg_a") => assistantOf(messages, id)?.content;

describe("applyTranscriptEvent: steps", () => {
	it("opens a step as an empty assistant message", () => {
		const messages = applyTranscriptEvent([user("msg_u")], step("msg_a", 123));

		expect(messages.at(-1)).toEqual({
			id: "msg_a",
			type: "assistant",
			agent: "code",
			model: MODEL,
			content: [],
			time: { created: 123 },
		});
	});

	it("closes the step still streaming when the next one starts", () => {
		const messages = applyTranscriptEvents(
			[],
			[
				step("msg_a"),
				event(
					"session.step.started",
					{
						assistantMessageID: "msg_b",
						agent: "code",
						model: MODEL,
						started: 200,
					},
					"evt_2",
					600,
				),
			],
		);

		expect(assistantOf(messages, "msg_a")?.time.completed).toBe(600);
		expect(assistantOf(messages, "msg_b")?.time.completed).toBeUndefined();
	});

	it("records a step's finish, cost and tokens when it ends", () => {
		const tokens = { ...ZERO_TOKENS, output: 7 };
		const messages = applyTranscriptEvents(
			[],
			[step("msg_a"), onStep("session.step.ended", { finish: "tool-calls", cost: 0.25, tokens })],
		);

		expect(assistantOf(messages)).toMatchObject({
			finish: "tool-calls",
			cost: 0.25,
			tokens,
			time: { created: 100, completed: 500 },
		});
	});

	it("records a failed step's error, finishing it as an error", () => {
		const error = { type: "api", message: "Rate limited" };
		const messages = applyTranscriptEvents(
			[],
			[step("msg_a"), onStep("session.step.failed", { error })],
		);

		expect(assistantOf(messages)).toMatchObject({
			finish: "error",
			error,
			time: { completed: 500 },
		});
	});

	it("starts a retried step over in the same message", () => {
		const failed = applyTranscriptEvents(
			[],
			[step("msg_a"), onStep("session.step.failed", { error: { type: "api", message: "boom" } })],
		);
		const retried = applyTranscriptEvent(failed, step("msg_a", 300));

		expect(retried).toHaveLength(1);
		expect(assistantOf(retried)).not.toHaveProperty("error");
		expect(assistantOf(retried)).not.toHaveProperty("finish");
		expect(assistantOf(retried)?.time).toEqual({ created: 300 });
	});

	it("marks a step's first token and end of streaming", () => {
		const messages = applyTranscriptEvents(
			[],
			[
				step("msg_a"),
				event("session.step.first-token", { assistantMessageID: "msg_a" }, "evt_2", 150),
				event("session.step.streamed", { assistantMessageID: "msg_a" }, "evt_3", 160),
			],
		);

		expect(assistantOf(messages)?.time).toEqual({ created: 100, firstToken: 150, streamed: 160 });
	});

	it("drops an event for a step the transcript doesn't hold", () => {
		const messages: Transcript = [user("msg_u")];

		expect(applyTranscriptEvent(messages, onStep("session.text.started"))).toBe(messages);
	});

	it("returns the same transcript for an event it doesn't fold", () => {
		const messages: Transcript = [user("msg_u")];

		expect(applyTranscriptEvent(messages, event("session.renamed", { title: "x" }))).toBe(messages);
	});
});

describe("applyTranscriptEvent: text and reasoning", () => {
	it("streams text into the step's latest text part", () => {
		const messages = applyTranscriptEvents(
			[streamingAssistant("msg_a")],
			[
				onStep("session.text.started", { ordinal: 0 }),
				onStep("session.text.delta", { ordinal: 0, delta: "Hel" }),
				onStep("session.text.delta", { ordinal: 0, delta: "lo" }),
			],
		);

		expect(contentOf(messages)).toEqual([text("Hello")]);
	});

	it("settles a text part on the text its end carries", () => {
		const messages = applyTranscriptEvents(
			[streamingAssistant("msg_a")],
			[
				onStep("session.text.started", { ordinal: 0 }),
				onStep("session.text.delta", { ordinal: 0, delta: "Hel" }),
				onStep("session.text.ended", { ordinal: 0, text: "Hello there" }),
			],
		);

		expect(contentOf(messages)).toEqual([text("Hello there")]);
	});

	it("streams a later ordinal into its own part after a tool call", () => {
		const messages = applyTranscriptEvents(
			[streamingAssistant("msg_a", [text("Before"), tool("call_1", "read")])],
			[
				onStep("session.text.started", { ordinal: 1 }),
				onStep("session.text.delta", { ordinal: 1, delta: "After" }),
			],
		);

		expect(contentOf(messages)).toEqual([text("Before"), tool("call_1", "read"), text("After")]);
	});

	it("streams reasoning into the open reasoning part and closes it at its end", () => {
		const messages = applyTranscriptEvents(
			[streamingAssistant("msg_a")],
			[
				event(
					"session.reasoning.started",
					{ assistantMessageID: "msg_a", ordinal: 0 },
					"evt_1",
					100,
				),
				onStep("session.reasoning.delta", { ordinal: 0, delta: "Think" }),
				event(
					"session.reasoning.ended",
					{ assistantMessageID: "msg_a", ordinal: 0, text: "Thinking" },
					"evt_3",
					140,
				),
			],
		);

		expect(contentOf(messages)).toEqual([
			{ type: "reasoning", text: "Thinking", time: { created: 100, completed: 140 } },
		]);
	});
});

describe("applyTranscriptEvent: tools", () => {
	const started = [streamingAssistant("msg_a")] as const;

	it("streams a tool call's input, then runs it with the parsed input", () => {
		const messages = applyTranscriptEvents(started, [
			onStep("session.tool.input.started", { id: "call_1", name: "shell" }),
			onStep("session.tool.input.delta", { id: "call_1", delta: '{"command":' }),
			onStep("session.tool.input.ended", { id: "call_1", text: '{"command":"ls"}' }),
		]);
		expect(contentOf(messages)?.[0]).toMatchObject({
			type: "tool",
			id: "call_1",
			name: "shell",
			state: { status: "streaming", input: '{"command":"ls"}' },
		});

		const running = applyTranscriptEvent(
			messages,
			onStep("session.tool.called", { id: "call_1", input: { command: "ls" }, executed: true }),
		);
		expect(contentOf(running)?.[0]).toMatchObject({
			executed: true,
			state: { status: "running", input: { command: "ls" }, metadata: {} },
			time: { ran: 500 },
		});
	});

	it("records a running tool's progress metadata", () => {
		const messages = applyTranscriptEvent(
			[
				streamingAssistant("msg_a", [
					{ ...tool("call_1", "subagent"), state: { status: "running", input: {}, metadata: {} } },
				]),
			],
			onStep("session.tool.progress", { id: "call_1", metadata: { sessionID: "ses_child" } }),
		);

		expect(contentOf(messages)?.[0]).toMatchObject({
			state: { metadata: { sessionID: "ses_child" } },
		});
	});

	it("completes a tool with its content and metadata", () => {
		const content = [{ type: "text", text: "done" }];
		const messages = applyTranscriptEvents(started, [
			onStep("session.tool.input.started", { id: "call_1", name: "read" }),
			onStep("session.tool.called", { id: "call_1", input: { path: "a.ts" } }),
			onStep("session.tool.success", {
				id: "call_1",
				content,
				metadata: { lines: 3 },
				executed: true,
			}),
		]);

		expect(contentOf(messages)?.[0]).toMatchObject({
			executed: true,
			state: { status: "completed", input: { path: "a.ts" }, content, metadata: { lines: 3 } },
			time: { completed: 500 },
		});
	});

	it("fails a tool with its error, dropping input that never parsed", () => {
		const error = { type: "tool", message: "Permission denied" };
		const messages = applyTranscriptEvents(started, [
			onStep("session.tool.input.started", { id: "call_1", name: "edit" }),
			onStep("session.tool.failed", { id: "call_1", error }),
		]);

		expect(contentOf(messages)?.[0]).toMatchObject({
			state: { status: "error", error, input: {} },
		});
	});

	it("addresses tools by call id", () => {
		const messages = applyTranscriptEvents(started, [
			onStep("session.tool.input.started", { id: "call_1", name: "read" }),
			onStep("session.tool.input.started", { id: "call_2", name: "glob" }),
			onStep("session.tool.called", { id: "call_1", input: { path: "a.ts" } }),
		]);

		expect(contentOf(messages)?.map((item) => item.type === "tool" && item.state.status)).toEqual([
			"running",
			"streaming",
		]);
	});

	it("ignores a result for a tool that isn't running", () => {
		const messages: Transcript = [streamingAssistant("msg_a", [tool("call_1", "read")])];

		expect(
			applyTranscriptEvent(messages, onStep("session.tool.success", { id: "call_1", content: [] })),
		).toBe(messages);
	});
});

describe("applyTranscriptEvent: inbox", () => {
	const enqueued = (
		inboxID: string,
		type: string,
		payload: Record<string, unknown>,
		created = 100,
	) =>
		event(
			"session.inbox.enqueued",
			{ inboxID, item: { type, payload, delivery: "queue" } },
			"evt_q",
			created,
		);

	it("admits a queued prompt as a user message", () => {
		const messages = applyTranscriptEvent(
			[],
			enqueued("msg_p", "user", { text: "hi", selection: { a: 1 } }),
		);

		expect(messages).toEqual([{ id: "msg_p", type: "user", text: "hi", time: { created: 100 } }]);
	});

	it("admits a synthetic note, but nothing else", () => {
		expect(
			applyTranscriptEvent([], enqueued("msg_s", "synthetic", { text: "note" })),
		).toMatchObject([{ id: "msg_s", type: "synthetic", text: "note" }]);
		const messages: Transcript = [];
		expect(applyTranscriptEvent(messages, enqueued("msg_c", "compaction", {}))).toBe(messages);
	});

	it("replaces an admitted prompt enqueued again", () => {
		const messages = applyTranscriptEvents(
			[],
			[enqueued("msg_p", "user", { text: "first" }), enqueued("msg_p", "user", { text: "edited" })],
		);

		expect(messages).toMatchObject([{ id: "msg_p", text: "edited" }]);
	});

	it("moves a delivered prompt to where the runner took it", () => {
		const messages = applyTranscriptEvents(
			[user("msg_queued", "later"), assistant("msg_a", [text("answer")])],
			[event("session.inbox.delivered", { inboxID: "msg_queued" }, "evt_d", 900)],
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_a", "msg_queued"]);
		expect(messages[1]?.time.created).toBe(900);
	});

	it("removes a cancelled prompt", () => {
		const messages = applyTranscriptEvent(
			[user("msg_u"), user("msg_queued")],
			event("session.inbox.cancelled", { inboxID: "msg_queued" }),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_u"]);
	});
});

describe("applyTranscriptEvent: execution", () => {
	it.each([
		["session.execution.succeeded", "succeeded"],
		["session.execution.failed", "failed"],
		["session.execution.interrupted", "interrupted"],
	] as const)("ends a turn on %s with an idle message", (type, outcome) => {
		const messages = applyTranscriptEvent([assistant("msg_a")], event(type, {}, "evt_000123", 700));

		expect(messages.at(-1)).toEqual({
			id: messageIdFromEvent("evt_000123"),
			type: "idle",
			outcome,
			time: { created: 700 },
		});
		expect(messages.at(-1)?.id).toBe("msg_000123");
	});

	it("keeps a failed execution's error on its idle message", () => {
		const error = { type: "provider", message: "Overloaded" };
		const messages = applyTranscriptEvent([], event("session.execution.failed", { error }));

		expect(messages.at(-1)).toMatchObject({ type: "idle", outcome: "failed", error });
	});

	it("writes no idle message for a shutdown, only clearing a pending retry", () => {
		const retrying = {
			...streamingAssistant("msg_a"),
			retry: { attempt: 1, at: 1, error: {} },
		} as SessionMessageInfo;
		const messages = applyTranscriptEvent(
			[retrying],
			event("session.execution.interrupted", { reason: "shutdown" }),
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]).not.toHaveProperty("retry");
	});
});

describe("applyTranscriptEvent: compaction and revert", () => {
	it("streams a compaction summary until it ends", () => {
		const messages = applyTranscriptEvents(
			[user("msg_u")],
			[
				event("session.compaction.started", { inputID: "msg_c", reason: "manual" }),
				event("session.compaction.delta", { text: "Sum" }),
				event("session.compaction.delta", { text: "mary" }),
			],
		);
		expect(messages.at(-1)).toMatchObject({
			id: "msg_c",
			type: "compaction",
			status: "running",
			summary: "Summary",
		});

		const ended = applyTranscriptEvent(
			messages,
			event("session.compaction.ended", { reason: "manual", text: "Final summary" }),
		);
		expect(ended.at(-1)).toMatchObject({
			id: "msg_c",
			status: "completed",
			summary: "Final summary",
		});
	});

	it("records a failed compaction", () => {
		const error = { type: "api", message: "Too long" };
		const messages = applyTranscriptEvents(
			[],
			[
				event("session.compaction.started", { inputID: "msg_c", reason: "auto" }),
				event("session.compaction.failed", { reason: "auto", error }),
			],
		);

		expect(messages).toMatchObject([{ id: "msg_c", type: "compaction", status: "failed", error }]);
	});

	it("drops the revert boundary and everything after it once committed", () => {
		const messages = applyTranscriptEvent(
			[user("msg_1"), assistant("msg_2"), user("msg_3"), assistant("msg_4")],
			event("session.revert.committed", { to: "msg_3" }),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
	});

	it("cuts at the first later id when the boundary isn't loaded", () => {
		const messages = applyTranscriptEvent(
			[user("msg_1"), assistant("msg_2"), user("msg_4")],
			event("session.revert.committed", { to: "msg_3" }),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
	});
});

describe("applyTranscriptEvent: identity", () => {
	it("replaces only the message an event changes, never mutating", () => {
		const settled = assistant("msg_old", [text("done")]);
		const live = streamingAssistant("msg_a", [text("Hel")]);
		const messages: Transcript = [settled, live];
		const snapshot = structuredClone(messages);

		const next = applyTranscriptEvent(
			messages,
			onStep("session.text.delta", { ordinal: 0, delta: "lo" }),
		);

		expect(next).not.toBe(messages);
		expect(next[0]).toBe(settled);
		expect(next[1]).not.toBe(live);
		expect(messages).toEqual(snapshot);
	});
});
