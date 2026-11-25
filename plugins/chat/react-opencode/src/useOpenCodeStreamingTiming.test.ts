import { describe, expect, it } from "vitest";

import {
	assistant,
	idle,
	reasoning,
	runningTool,
	streamingAssistant,
	text,
	threadState,
	tool,
	user,
} from "./testUtils";
import {
	getLastAssistantId,
	getMessageTextLength,
	getMessageToolCallCount,
} from "./useOpenCodeStreamingTiming";

describe("getLastAssistantId", () => {
	it("returns undefined for an empty thread", () => {
		expect(getLastAssistantId(threadState())).toBeUndefined();
	});

	it("returns the latest step, past the turn's idle message", () => {
		const state = threadState([
			user("msg_1"),
			assistant("msg_2", [text("first")]),
			assistant("msg_3", [text("second")]),
			idle("msg_4"),
		]);

		expect(getLastAssistantId(state)).toBe("msg_3");
	});

	it("ignores a user message after the latest step", () => {
		expect(getLastAssistantId(threadState([assistant("msg_1"), user("msg_2")]))).toBe("msg_1");
	});
});

describe("getMessageTextLength", () => {
	it("returns 0 for an unknown or non-assistant message", () => {
		const state = threadState([user("msg_1", "hello")]);

		expect(getMessageTextLength(state, "missing")).toBe(0);
		expect(getMessageTextLength(state, "msg_1")).toBe(0);
	});

	it("sums a step's text and reasoning, ignoring tools", () => {
		const state = threadState([
			streamingAssistant("msg_1", [
				reasoning("think"),
				text("hello"),
				tool("call_1", "read", {}, "long output"),
			]),
		]);

		expect(getMessageTextLength(state, "msg_1")).toBe("think".length + "hello".length);
	});
});

describe("getMessageToolCallCount", () => {
	it("returns 0 for an unknown message or a step without tools", () => {
		const state = threadState([assistant("msg_1", [text("hi")])]);

		expect(getMessageToolCallCount(state, "missing")).toBe(0);
		expect(getMessageToolCallCount(state, "msg_1")).toBe(0);
	});

	it("counts a step's tool calls, running or settled", () => {
		const state = threadState([
			streamingAssistant("msg_1", [
				text("a"),
				tool("call_1", "read"),
				runningTool("call_2", "shell"),
			]),
		]);

		expect(getMessageToolCallCount(state, "msg_1")).toBe(2);
	});
});
