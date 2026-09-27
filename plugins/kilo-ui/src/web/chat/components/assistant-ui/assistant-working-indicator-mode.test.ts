import { describe, expect, it } from "vitest";

import {
	assistantWorkingIndicatorMode,
	messageHasInFlightActivity,
	openCodeTextIsStreaming,
} from "./assistant-working-indicator-mode.js";

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
	it("is true while an OpenCode text part has started but not ended", () => {
		expect(openCodeTextIsStreaming([{ type: "text", time: { start: 1 } }])).toBe(true);
	});

	it("is false once every text part has ended", () => {
		expect(openCodeTextIsStreaming([{ type: "text", time: { start: 1, end: 2 } }])).toBe(false);
	});

	it("ignores synthetic text, non-text parts, and missing part data", () => {
		expect(openCodeTextIsStreaming([{ type: "text", synthetic: true, time: { start: 1 } }])).toBe(
			false,
		);
		expect(openCodeTextIsStreaming([{ type: "reasoning", time: { start: 1 } }])).toBe(false);
		expect(openCodeTextIsStreaming([{ type: "text" }])).toBe(false);
		expect(openCodeTextIsStreaming(undefined)).toBe(false);
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
