import type { OpenCodeServerEvent } from "@kilo-desktop/react-opencode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventBatcher, EVENT_BATCH_INTERVAL_MS } from "./event-batcher";

const delta = (text: string, partID = "part_1", sessionId = "ses_1"): OpenCodeServerEvent => ({
	type: "message.part.delta",
	sessionId,
	raw: undefined,
	properties: { sessionID: sessionId, messageID: "msg_1", partID, field: "text", delta: text },
});

const event = (type: string): OpenCodeServerEvent => ({
	type,
	sessionId: "ses_1",
	raw: undefined,
	properties: {},
});

const summary = (events: readonly OpenCodeServerEvent[]) =>
	events.map((received) =>
		received.type === "message.part.delta"
			? `${received.properties.partID}:${received.properties.delta}`
			: received.type,
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
		batcher.push(delta("b", "part_2"));
		expect(received).toEqual([]);

		vi.advanceTimersByTime(EVENT_BATCH_INTERVAL_MS);
		expect(summary(received)).toEqual(["part_1:a", "part_2:b"]);
	});

	it("delivers any other event at once, after the deltas queued before it", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		batcher.push(delta("a"));
		batcher.push(event("stream.reconnected"));

		expect(summary(received)).toEqual(["part_1:a", "stream.reconnected"]);
	});

	it("joins a run of deltas to the same part into one", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		for (const word of ["Hel", "lo", " wor", "ld"]) batcher.push(delta(word));
		batcher.flush();

		expect(summary(received)).toEqual(["part_1:Hello world"]);
	});

	it("keeps the order of everything else, joining only adjacent deltas to one part", () => {
		const batcher = createEventBatcher();
		const received: OpenCodeServerEvent[] = [];
		batcher.subscribe((next) => received.push(next));

		batcher.push(delta("a"));
		batcher.push(delta("b"));
		batcher.push(delta("x", "part_2"));
		batcher.push(event("message.part.updated"));
		batcher.push(delta("c"));
		batcher.push(delta("z", "part_1", "ses_2"));
		batcher.flush();

		expect(summary(received)).toEqual([
			"part_1:ab",
			"part_2:x",
			"message.part.updated",
			"part_1:c",
			"part_1:z",
		]);
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

		expect(summary(early)).toEqual(["part_1:a", "part_1:b"]);
		expect(summary(late)).toEqual(["part_1:b", "part_1:c"]);
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
