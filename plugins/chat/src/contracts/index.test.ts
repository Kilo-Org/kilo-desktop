import { describe, expect, it } from "vitest";

import { agentPaneChatId, planPaneMetadata, subagentPaneId, subagentPaneMetadata } from "./index";

describe("agentPaneChatId", () => {
	it("prefers the chat named in the pane, then the session's first, else none", () => {
		expect(agentPaneChatId({ metadata: { chatId: "ses_b" } }, { chatIds: ["ses_a"] })).toBe(
			"ses_b",
		);
		expect(agentPaneChatId({ metadata: {} }, { chatIds: ["ses_a", "ses_c"] })).toBe("ses_a");
		expect(agentPaneChatId({ metadata: {} }, { chatIds: [] })).toBeNull();
		expect(agentPaneChatId({ metadata: {} }, undefined)).toBeNull();
	});
});

describe("plan and subagent pane metadata", () => {
	it("names the chat and the plan revision opened", () => {
		expect(
			planPaneMetadata("ses_a", { anchorCallId: "call_2", newestAnchorCallId: "call_1" }),
		).toEqual({
			chatId: "ses_a",
			planAnchorCallId: "call_2",
			planNewestAnchorCallIdAtOpen: "call_1",
		});
	});

	it("keys a subagent pane by its child chat, with the delegating chat when known", () => {
		expect(subagentPaneId("ses_child")).toBe("subagent:ses_child");
		expect(subagentPaneMetadata("ses_child", "ses_a")).toEqual({
			childSessionId: "ses_child",
			chatId: "ses_a",
		});
		expect(subagentPaneMetadata("ses_child", null)).toEqual({ childSessionId: "ses_child" });
	});
});
