import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it } from "vitest";

import {
	assistantWorkingIndicatorMode,
	messageHasInFlightActivity,
	openCodeTextIsStreaming,
} from "./assistant-working-indicator-mode";

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
	const step = (content: unknown[], completed?: number) =>
		({
			id: "msg_a",
			type: "assistant",
			agent: "code",
			model: { providerID: "kilo", id: "m" },
			content,
			time: completed === undefined ? { created: 1 } : { created: 1, completed },
		}) as SessionMessageInfo;

	it("is true while a running step's latest content is text", () => {
		expect(openCodeTextIsStreaming([step([{ type: "text", text: "Hel" }])])).toBe(true);
	});

	it("is false once the step ends or moves on to a tool call", () => {
		expect(openCodeTextIsStreaming([step([{ type: "text", text: "Hello" }], 2)])).toBe(false);
		expect(
			openCodeTextIsStreaming([
				step([
					{ type: "text", text: "Let me look" },
					{
						type: "tool",
						id: "c",
						name: "read",
						time: { created: 1 },
						state: { status: "streaming", input: "" },
					},
				]),
			]),
		).toBe(false);
	});

	it("ignores reasoning and messages that are not steps", () => {
		expect(openCodeTextIsStreaming([step([{ type: "reasoning", text: "hm" }])])).toBe(false);
		expect(
			openCodeTextIsStreaming([{ id: "u", type: "user", text: "hi", time: { created: 1 } }]),
		).toBe(false);
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
