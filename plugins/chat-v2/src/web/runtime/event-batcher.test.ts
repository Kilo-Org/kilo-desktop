import {
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode-v2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamEvent, streamEventType } from "../../test/stream-events";
import { createEventBatcher, EVENT_BATCH_INTERVAL_MS } from "./event-batcher";

const delta = (text: string, ordinal = 0, sessionId = "ses_1"): OpenCodeServerEvent =>
	streamEvent("session.text.delta", {
		sessionID: sessionId,
		assistantMessageID: "msg_1",
		ordinal,
		delta: text,
	});

const event = (type: string): OpenCodeServerEvent => streamEvent(type, { sessionID: "ses_1" });

const summary = (events: readonly OpenCodeServerEvent[]) =>
	events.map((received) =>
		received.type === "kilo.event" && received.event.type === "session.text.delta"
			? `${received.event.data.ordinal}:${received.event.data.delta}`
			: streamEventType(received),
	);

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
		batcher.push({ type: STREAM_RECONNECTED_EVENT_TYPE });

		expect(summary(received)).toEqual(["0:a", "stream.reconnected"]);
	});

	it("joins a run of deltas to the same item into one, rewriting only its delta", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		for (const word of ["Hel", "lo", " wor", "ld"]) batcher.push(delta(word));
		batcher.flush();

		expect(summary(received)).toEqual(["0:Hello world"]);
		expect(received[0]).toMatchObject({
			type: "kilo.event",
			sessionId: "ses_1",
			event: {
				type: "session.text.delta",
				data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "Hello world" },
			},
		});
	});

	it("keeps the order of everything else, joining only adjacent deltas to one item", () => {
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
		batcher.subscribe((next) => received.push(streamEventType(next)));

		batcher.push(event("session.execution.succeeded"));
		batcher.flush();

		expect(received).toEqual(["session.execution.succeeded"]);
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
