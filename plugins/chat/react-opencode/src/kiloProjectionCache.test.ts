import { describe, expect, it } from "vitest";

import {
	createOpenCodeProjectionCache,
	projectOpenCodeThreadRepository,
} from "./openCodeMessageProjection";
import { reduceOpenCodeThreadState } from "./openCodeThreadState";
import {
	assistant,
	permissionRequest,
	serverEvent,
	streamingAssistant,
	text,
	threadState,
	tool,
	user,
} from "./testUtils";
import type { OpenCodeStateEvent, OpenCodeThreadState } from "./types";

/*
 * Projection cache (requirement R11 in docs/kilo-v2.md): a streamed token
 * re-projects only the message it changed. Every other message keeps its
 * ThreadMessage, so its components skip the render; that keeps a token's
 * cost flat as the session grows.
 */

/** A session whose last turn is streaming its second step. */
const streaming = (): OpenCodeThreadState =>
	threadState(
		[
			user("msg_1"),
			assistant("msg_2", [text("First answer"), tool("call_a", "edit")]),
			user("msg_3"),
			assistant("msg_4", [tool("call_b", "edit")]),
			streamingAssistant("msg_5", [text("Work")]),
		],
		{ running: true },
	);

const delta = (value: string): OpenCodeStateEvent => ({
	type: "server.event",
	event: serverEvent("session.text.delta", {
		assistantMessageID: "msg_5",
		ordinal: 0,
		delta: value,
	}),
});

const threadMessages = (state: OpenCodeThreadState, cache = createOpenCodeProjectionCache()) =>
	projectOpenCodeThreadRepository(state, {}, cache).messages.map(({ message }) => message);

describe("projectOpenCodeThreadRepository with a projection cache", () => {
	it("keeps every message a streamed token didn't touch, by identity", () => {
		const cache = createOpenCodeProjectionCache();
		const state = streaming();
		const before = threadMessages(state, cache);
		const after = threadMessages(reduceOpenCodeThreadState(state, delta("ing")), cache);

		expect(after.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
		after.slice(0, -1).forEach((message, index) => expect(message).toBe(before[index]));
		expect(after.at(-1)).not.toBe(before.at(-1));
		expect(after.at(-1)?.content.filter((part) => part.type === "text")).toEqual([
			{ type: "text", text: "Working" },
		]);
	});

	it("projects the same messages as an uncached projection", () => {
		const cache = createOpenCodeProjectionCache();
		const state = streaming();
		threadMessages(state, cache);
		const next = reduceOpenCodeThreadState(state, delta("ing"));

		const strip = (list: ReturnType<typeof threadMessages>) =>
			list.map(({ createdAt: _createdAt, ...message }) => message);
		expect(strip(threadMessages(next, cache))).toEqual(
			strip(projectOpenCodeThreadRepository(next).messages.map(({ message }) => message)),
		);
	});

	it("keeps a turn's id when its next step starts", () => {
		const cache = createOpenCodeProjectionCache();
		const state = streaming();
		const beforeStep = threadMessages({ ...state, messages: state.messages.slice(0, -1) }, cache);
		const afterStep = threadMessages(state, cache);

		expect(beforeStep.at(-1)?.id).toBe("msg_4");
		expect(afterStep.at(-1)?.id).toBe("msg_4");
		expect(afterStep.at(-1)?.status).toEqual({ type: "running" });
	});

	it("re-projects the latest turn once the run stops, keeping earlier ones", () => {
		const cache = createOpenCodeProjectionCache();
		const state = streaming();
		const running = threadMessages(state, cache);
		const stopped = threadMessages(
			reduceOpenCodeThreadState(state, { type: "status", running: false }),
			cache,
		);

		expect(running.at(-1)?.status).toEqual({ type: "running" });
		expect(stopped.at(-1)?.status).toEqual({ type: "incomplete", reason: "cancelled" });
		expect(stopped[1]).toBe(running[1]);
	});

	it("re-projects a message when a permission is asked for one of its tools", () => {
		const cache = createOpenCodeProjectionCache();
		const state = streaming();
		const before = threadMessages(state, cache);
		const asked = reduceOpenCodeThreadState(state, {
			type: "server.event",
			event: serverEvent("permission.asked", {
				...permissionRequest("per_1", {
					source: { type: "tool", messageID: "msg_2", id: "call_a" },
				}),
			}),
		});
		const after = threadMessages(asked, cache);

		expect(after[1]).not.toBe(before[1]);
		expect(after[1]?.status).toEqual({ type: "requires-action", reason: "tool-calls" });
		expect(after[0]).toBe(before[0]);
	});

	it("forgets messages that left the transcript", () => {
		const cache = createOpenCodeProjectionCache();
		const state = streaming();
		threadMessages(state, cache);
		threadMessages({ ...state, messages: state.messages.slice(0, 2) }, cache);

		expect([...cache.server.keys()]).toEqual(["msg_1", "msg_2"]);
	});
});
