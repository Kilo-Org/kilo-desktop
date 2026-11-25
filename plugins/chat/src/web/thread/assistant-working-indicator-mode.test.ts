import { describe, expect, it } from "vitest";

import {
	assistantWorkingIndicatorMode,
	messageHasInFlightActivity,
	openCodeTextIsStreaming,
} from "./assistant-working-indicator-mode";
import { assistantMessage, reasoning, text, userMessage } from "../../test/kilo2/fixtures";

describe("messageHasInFlightActivity", () => {
	it("is false when nothing is running", () => {
		expect(messageHasInFlightActivity([])).toBe(false);
		expect(messageHasInFlightActivity([{ type: "tool-call", status: { type: "complete" } }])).toBe(
			false,
		);
		expect(messageHasInFlightActivity([{ type: "reasoning", status: { type: "complete" } }])).toBe(
			false,
		);
	});

	it("is true when a tool call or reasoning part is running", () => {
		expect(messageHasInFlightActivity([{ type: "tool-call", status: { type: "running" } }])).toBe(
			true,
		);
		expect(messageHasInFlightActivity([{ type: "reasoning", status: { type: "running" } }])).toBe(
			true,
		);
	});

	it("is true when an earlier tool is still running after a later complete part", () => {
		expect(
			messageHasInFlightActivity([
				{ type: "tool-call", status: { type: "running" } },
				{ type: "tool-call", status: { type: "complete" } },
				{ type: "data" },
			]),
		).toBe(true);
	});
});

describe("openCodeTextIsStreaming", () => {
	const streamingStep = (content: Parameters<typeof assistantMessage>[0]) =>
		assistantMessage(content, { time: { created: 1, firstToken: 2 } });

	it("is true while the latest step is still emitting text", () => {
		expect(openCodeTextIsStreaming([userMessage("hi"), streamingStep([text("Hel")])])).toBe(true);
	});

	it("is false once the step has streamed or completed", () => {
		expect(openCodeTextIsStreaming([assistantMessage([text("Hello")])])).toBe(false);
		expect(
			openCodeTextIsStreaming([
				assistantMessage([text("Hello")], { time: { created: 1, streamed: 2 } }),
			]),
		).toBe(false);
	});

	it("is false while the step's newest content is not text, or without steps", () => {
		expect(openCodeTextIsStreaming([streamingStep([text("Let me look"), reasoning("hmm")])])).toBe(
			false,
		);
		expect(openCodeTextIsStreaming([userMessage("hi")])).toBe(false);
		expect(openCodeTextIsStreaming([])).toBe(false);
	});
});

describe("assistantWorkingIndicatorMode", () => {
	const idle = {
		pendingUserInteractions: 0,
		hasInFlightActivity: false,
		isStreamingText: false,
		hasActiveSubagents: false,
	};

	it("hides considering-next-steps while reply text is streaming", () => {
		expect(assistantWorkingIndicatorMode({ ...idle, isStreamingText: true })).toBe("never");
	});

	it("hides considering-next-steps while subagents are working", () => {
		expect(assistantWorkingIndicatorMode({ ...idle, hasActiveSubagents: true })).toBe("never");
	});

	it("hides considering-next-steps while a question or permission awaits the user", () => {
		expect(assistantWorkingIndicatorMode({ ...idle, pendingUserInteractions: 1 })).toBe("never");
	});

	it("hides considering-next-steps while a tool or subgroup is running", () => {
		expect(assistantWorkingIndicatorMode({ ...idle, hasInFlightActivity: true })).toBe("never");
	});

	it("keeps the default indicator while the assistant is generating", () => {
		expect(assistantWorkingIndicatorMode(idle)).toBe("no-text");
	});
});
