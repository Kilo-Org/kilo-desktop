import type { OpenCodeServerEvent } from "@kilo-desktop/react-opencode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventBatcher, EVENT_BATCH_INTERVAL_MS } from "./event-batcher";

const delta = (text: string, ordinal = 0, sessionId = "ses_1"): OpenCodeServerEvent => ({
	type: "session.text.delta",
	sessionId,
	data: { sessionID: sessionId, assistantMessageID: "msg_1", ordinal, delta: text },
});

const toolInput = (text: string, id: string): OpenCodeServerEvent => ({
	type: "session.tool.input.delta",
	sessionId: "ses_1",
	data: { sessionID: "ses_1", assistantMessageID: "msg_1", id, delta: text },
});

const compaction = (text: string): OpenCodeServerEvent => ({
	type: "session.compaction.delta",
	sessionId: "ses_1",
	data: { sessionID: "ses_1", text },
});

const event = (type: string): OpenCodeServerEvent => ({ type, sessionId: "ses_1", data: {} });

const summary = (events: readonly OpenCodeServerEvent[]) =>
	events.map((received) => {
		if (received.type === "session.text.delta") {
			return `${String(received.data.ordinal)}:${String(received.data.delta)}`;
		}
		if (received.type === "session.tool.input.delta") {
			return `${String(received.data.id)}:${String(received.data.delta)}`;
		}
		if (received.type === "session.compaction.delta")
			return `compaction:${String(received.data.text)}`;
		return received.type;
	});

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("createEventBatcher", () => {
	it("holds deltas until the interval passes", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		batcher.push(delta("a"));
		batcher.push(delta("b", 1));
		expect(received).toEqual([]);

		vi.advanceTimersByTime(EVENT_BATCH_INTERVAL_MS);
		expect(summary(received)).toEqual(["0:a", "1:b"]);
	});

	it("delivers any other event at once, after the deltas queued before it", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		batcher.push(delta("a"));
		batcher.push(event("stream.reconnected"));

		expect(summary(received)).toEqual(["0:a", "stream.reconnected"]);
	});

	it("joins a run of deltas to the same part into one", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		for (const word of ["Hel", "lo", " wor", "ld"]) batcher.push(delta(word));
		batcher.flush();

		expect(summary(received)).toEqual(["0:Hello world"]);
	});

	it("keeps the order of everything else, joining only adjacent deltas to one part", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		batcher.push(delta("a"));
		batcher.push(delta("b"));
		batcher.push(delta("x", 1));
		batcher.push(event("session.text.ended"));
		batcher.push(delta("c"));
		batcher.push(delta("z", 0, "ses_2"));
		batcher.flush();

		expect(summary(received)).toEqual(["0:ab", "1:x", "session.text.ended", "0:c", "0:z"]);
	});

	it("joins tool input per call and compaction text, never across kinds", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		batcher.push(toolInput('{"a"', "call_1"));
		batcher.push(toolInput(":1}", "call_1"));
		batcher.push(toolInput("{}", "call_2"));
		batcher.push(compaction("Sum"));
		batcher.push(compaction("mary"));
		batcher.push(delta("x"));
		batcher.flush();

		expect(summary(received)).toEqual(['call_1:{"a":1}', "call_2:{}", "compaction:Summary", "0:x"]);
	});

	it("gives a listener only the events after it subscribed, and those queued before it left", () => {
		const batcher = createEventBatcher();
		const early: OpenCodeServerEvent[] = [];
		const late: OpenCodeServerEvent[] = [];
		const leaveEarly = batcher.subscribe((next) => early.push(next));

		batcher.push(delta("a"));
		batcher.subscribe((next) => late.push(next));
		batcher.push(delta("b"));
		leaveEarly();
		batcher.push(delta("c"));
		batcher.flush();

		expect(summary(early)).toEqual(["0:a", "0:b"]);
		expect(summary(late)).toEqual(["0:b", "0:c"]);
	});

	it("still delivers to every listener when one throws", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const batcher = createEventBatcher();
		const received: string[] = [];
		batcher.subscribe(() => {
			throw new Error("broken");
		});
		batcher.subscribe((next) => received.push(next.type));

		batcher.push(event("session.idle"));
		batcher.flush();

		expect(received).toEqual(["session.idle"]);
	});

	it("drops what's queued when disposed", () => {
		const batcher = createEventBatcher();
		const listener = vi.fn();
		batcher.subscribe(listener);

		batcher.push(delta("a"));
		batcher.dispose();
		vi.advanceTimersByTime(EVENT_BATCH_INTERVAL_MS);

		expect(listener).not.toHaveBeenCalled();
	});
});
