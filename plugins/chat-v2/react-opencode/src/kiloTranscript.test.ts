import type { OpenCodeEvent, SessionMessageInfo } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import { foldKiloEvent, foldKiloSessionEvent, type KiloTranscript } from "./kiloTranscript";
import turn from "./v2/fixtures/read-tool-turn.json";

const EMPTY: KiloTranscript = { messageOrder: [], messagesById: {}, inbox: {} };

const fold = (events: readonly unknown[], start: KiloTranscript = EMPTY) =>
	events.reduce<KiloTranscript>(
		(transcript, event) => foldKiloEvent(transcript, event as OpenCodeEvent),
		start,
	);

const messagesOf = (transcript: KiloTranscript) =>
	transcript.messageOrder.map((id) => transcript.messagesById[id]!);

const event = (type: string, data: Record<string, unknown>, created = 10, id?: string) =>
	({
		type,
		data: { sessionID: "ses_1", ...data },
		created,
		...(id ? { id } : {}),
	}) as unknown as OpenCodeEvent;

const ids = { assistantMessageID: "msg_a1" };
const stepStarted = event("session.step.started", {
	...ids,
	agent: "code",
	model: { providerID: "kilo", id: "m" },
	started: 5,
	snapshot: "snap_1",
});

describe("a real kilo2 turn", () => {
	it("streams into the transcript its history loads as", () => {
		const streamed = messagesOf(fold(turn.events));
		const loaded = turn.messages as unknown as SessionMessageInfo[];
		// Recorded events carry no ids, so the idle marker they start is named by time.
		expect(streamed.map((message) => message.type)).toEqual(loaded.map((message) => message.type));
		expect(streamed.slice(0, -1)).toEqual(loaded.slice(0, -1));
		expect(streamed.at(-1)).toMatchObject({ type: "idle", outcome: "succeeded" });
	});
});

describe("foldKiloEvent", () => {
	it("holds a prompt in the inbox until it is delivered, under its inbox id", () => {
		const enqueued = fold([
			event("session.inbox.enqueued", {
				inboxID: "msg_u1",
				item: { type: "user", delivery: "steer", payload: { text: "hi", files: [] } },
			}),
		]);
		expect(enqueued.messageOrder).toEqual([]);
		const delivered = fold([event("session.inbox.delivered", { inboxID: "msg_u1" }, 20)], enqueued);
		expect(messagesOf(delivered)).toEqual([
			{ id: "msg_u1", type: "user", text: "hi", files: [], time: { created: 20 } },
		]);
		expect(delivered.inbox).toEqual({});
	});

	it("drops a cancelled inbox item", () => {
		const transcript = fold([
			event("session.inbox.enqueued", {
				inboxID: "msg_u1",
				item: { type: "user", delivery: "queue", payload: { text: "hi" } },
			}),
			event("session.inbox.cancelled", { inboxID: "msg_u1" }),
			event("session.inbox.delivered", { inboxID: "msg_u1" }),
		]);
		expect(transcript.messageOrder).toEqual([]);
	});

	it("streams a step's reasoning, text and tool call into its content", () => {
		const transcript = fold([
			stepStarted,
			event("session.reasoning.started", { ...ids, ordinal: 0 }, 11),
			event("session.reasoning.delta", { ...ids, ordinal: 0, delta: "thin" }),
			event("session.reasoning.ended", { ...ids, ordinal: 0, text: "think" }, 12),
			event("session.text.started", { ...ids, ordinal: 0 }),
			event("session.text.delta", { ...ids, ordinal: 0, delta: "Hel" }),
			event("session.text.delta", { ...ids, ordinal: 0, delta: "lo" }),
			event("session.tool.input.started", { ...ids, id: "call_1", name: "shell" }, 13),
			event("session.tool.input.delta", { ...ids, id: "call_1", delta: '{"command"' }),
			event(
				"session.tool.called",
				{ ...ids, id: "call_1", input: { command: "ls" }, executed: false },
				14,
			),
			event("session.tool.progress", { ...ids, id: "call_1", metadata: { output: "a" } }),
			event(
				"session.tool.success",
				{
					...ids,
					id: "call_1",
					content: [{ type: "text", text: "a\nb" }],
					metadata: { exit: 0 },
					executed: true,
				},
				15,
			),
			event(
				"session.step.ended",
				{
					...ids,
					finish: "stop",
					cost: 0.5,
					tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
					snapshot: "snap_2",
					files: ["a.ts"],
				},
				16,
			),
		]);
		expect(transcript.messagesById.msg_a1).toEqual({
			id: "msg_a1",
			type: "assistant",
			agent: "code",
			model: { providerID: "kilo", id: "m" },
			snapshot: { start: "snap_1", end: "snap_2", files: ["a.ts"] },
			time: { created: 5, completed: 16 },
			finish: "stop",
			cost: 0.5,
			tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
			content: [
				{ type: "reasoning", text: "think", time: { created: 11, completed: 12 } },
				{ type: "text", text: "Hello" },
				{
					type: "tool",
					id: "call_1",
					name: "shell",
					executed: true,
					time: { created: 13, ran: 14, completed: 15 },
					state: {
						status: "completed",
						input: { command: "ls" },
						content: [{ type: "text", text: "a\nb" }],
						metadata: { exit: 0 },
					},
				},
			],
		});
	});

	it("keeps a tool's streamed input until it is called, and fails it with Kilo's error", () => {
		const streaming = fold([
			stepStarted,
			event("session.tool.input.started", { ...ids, id: "call_1", name: "read" }),
			event("session.tool.input.ended", { ...ids, id: "call_1", text: '{"path":"a"}' }),
		]);
		const assistant = streaming.messagesById.msg_a1;
		expect(assistant?.type === "assistant" && assistant.content[0]).toMatchObject({
			state: { status: "streaming", input: '{"path":"a"}' },
		});
		const failed = fold(
			[
				event("session.tool.failed", {
					...ids,
					id: "call_1",
					error: { type: "tool", message: "nope" },
					executed: false,
				}),
			],
			streaming,
		);
		const after = failed.messagesById.msg_a1;
		expect(after?.type === "assistant" && after.content[0]).toMatchObject({
			state: { status: "error", input: {}, error: { type: "tool", message: "nope" } },
		});
	});

	it("starts a step's text whole when its start was missed", () => {
		const transcript = fold([
			stepStarted,
			event("session.text.delta", { ...ids, ordinal: 1, delta: "late" }),
		]);
		const assistant = transcript.messagesById.msg_a1;
		expect(assistant?.type === "assistant" && assistant.content).toEqual([
			{ type: "text", text: "late" },
		]);
	});

	it("records a failed step's error and a scheduled retry", () => {
		const retrying = fold([
			stepStarted,
			event("session.retry.scheduled", {
				...ids,
				attempt: 2,
				at: 99,
				error: { type: "rate", message: "slow" },
			}),
		]);
		expect(retrying.messagesById.msg_a1).toMatchObject({ retry: { attempt: 2, at: 99 } });
		const failed = fold(
			[event("session.step.failed", { ...ids, error: { type: "provider", message: "boom" } }, 30)],
			retrying,
		);
		expect(failed.messagesById.msg_a1).toMatchObject({
			finish: "error",
			error: { type: "provider", message: "boom" },
			time: { completed: 30 },
		});
		expect(failed.messagesById.msg_a1).not.toHaveProperty("retry");
	});

	it("closes the running step when the next one starts", () => {
		const transcript = fold([
			stepStarted,
			event(
				"session.step.started",
				{
					assistantMessageID: "msg_a2",
					agent: "code",
					model: { providerID: "kilo", id: "m" },
					started: 40,
				},
				41,
			),
		]);
		expect(transcript.messageOrder).toEqual(["msg_a1", "msg_a2"]);
		expect(transcript.messagesById.msg_a1).toMatchObject({ time: { completed: 41 } });
	});

	it("names messages an event starts after the event, as the history does", () => {
		const transcript = fold([
			event("session.synthetic", { text: "note" }, 1, "evt_1"),
			event("session.skill.activated", { id: "sk", name: "Skill", text: "use it" }, 2, "evt_2"),
			event("session.agent.selected", { agent: "plan" }, 3, "evt_3"),
			event(
				"session.shell.started",
				{ shell: { id: "sh_1", command: "ls", status: "running", time: { started: 4 } } },
				4,
				"evt_4",
			),
			event(
				"session.shell.ended",
				{
					shell: { id: "sh_1", command: "ls", status: "exited", exit: 0, time: { started: 4 } },
					output: { output: "a", cursor: 1, size: 1, truncated: false },
				},
				5,
				"evt_5",
			),
			event("session.execution.succeeded", {}, 6, "evt_6"),
		]);
		expect(messagesOf(transcript)).toEqual([
			{ id: "msg_1", type: "synthetic", text: "note", time: { created: 1 } },
			{
				id: "msg_2",
				type: "skill",
				skill: "sk",
				name: "Skill",
				text: "use it",
				time: { created: 2 },
			},
			{ id: "msg_3", type: "agent-switched", agent: "plan", time: { created: 3 } },
			{
				id: "msg_4",
				type: "shell",
				shellID: "sh_1",
				command: "ls",
				status: "exited",
				exit: 0,
				output: { output: "a", cursor: 1, size: 1, truncated: false },
				time: { created: 4, completed: 5 },
			},
			{ id: "msg_6", type: "idle", outcome: "succeeded", time: { created: 6 } },
		]);
	});

	it("runs a compaction from its request to its summary", () => {
		const transcript = fold([
			event("session.inbox.enqueued", {
				inboxID: "msg_c",
				item: { type: "compaction", delivery: "steer", payload: {} },
			}),
			event("session.compaction.started", { reason: "manual", inputID: "msg_c" }, 7),
			event("session.compaction.delta", { text: "Sum" }),
			event("session.compaction.ended", { reason: "manual", text: "Summary", cost: 1 }, 8),
		]);
		expect(transcript.inbox).toEqual({});
		expect(messagesOf(transcript)).toEqual([
			{
				id: "msg_c",
				type: "compaction",
				status: "completed",
				reason: "manual",
				summary: "Summary",
				cost: 1,
				time: { created: 7 },
			},
		]);
	});

	it("cuts the transcript at a committed revert", () => {
		const transcript = fold([
			event("session.synthetic", { text: "a" }, 1, "evt_1"),
			event("session.synthetic", { text: "b" }, 2, "evt_2"),
			event("session.synthetic", { text: "c" }, 3, "evt_3"),
			event("session.revert.committed", { to: "msg_2" }),
		]);
		expect(transcript.messageOrder).toEqual(["msg_1"]);
	});

	it("returns the same transcript for events that change nothing", () => {
		const transcript = fold([stepStarted]);
		expect(
			fold(
				[event("session.text.delta", { assistantMessageID: "msg_x", ordinal: 0, delta: "x" })],
				transcript,
			),
		).toBe(transcript);
		expect(fold([event("project.updated", {})], transcript)).toBe(transcript);
	});
});

describe("foldKiloSessionEvent", () => {
	const session = turn.session as never;

	it("applies renames, usage, selections and reverts to the session", () => {
		let next = foldKiloSessionEvent(session, event("session.renamed", { title: "New" }));
		next = foldKiloSessionEvent(
			next,
			event("session.usage.updated", {
				cost: 2,
				tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
			}),
		);
		next = foldKiloSessionEvent(next, event("session.agent.selected", { agent: "plan" }));
		next = foldKiloSessionEvent(
			next,
			event("session.revert.staged", { revert: { messageID: "msg_2" } }),
		);
		expect(next).toMatchObject({
			title: "New",
			cost: 2,
			agent: "plan",
			revert: { messageID: "msg_2" },
		});
		expect(foldKiloSessionEvent(next, event("session.revert.cleared", {}))).not.toHaveProperty(
			"revert",
		);
		expect(foldKiloSessionEvent(next, event("project.updated", {}))).toBe(next);
	});
});
