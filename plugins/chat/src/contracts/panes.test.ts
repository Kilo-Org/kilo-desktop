import { describe, expect, it } from "vitest";

import {
	chatPaneObject,
	paneChatId,
	planPaneMetadata,
	subagentPaneChildChatId,
	subagentPaneId,
	subagentPaneMetadata,
	subagentPaneParentChatId,
} from "./index";

describe("paneChatId", () => {
	it("reads the chat from the pane's object, else from an adopted pane's metadata", () => {
		expect(paneChatId({ metadata: {}, object: chatPaneObject("ses_a") })).toBe("ses_a");
		expect(paneChatId({ metadata: { chatId: "ses_b" } })).toBe("ses_b");
		expect(
			paneChatId({ metadata: {}, object: { type: "kilo.work-sessions/file", id: "/a" } }),
		).toBeNull();
		expect(paneChatId({ metadata: {} })).toBeNull();
	});
});

describe("plan and subagent panes", () => {
	it("names the plan revision opened", () => {
		expect(planPaneMetadata({ anchorCallId: "call_2", newestAnchorCallId: "call_1" })).toEqual({
			planAnchorCallId: "call_2",
			planNewestAnchorCallIdAtOpen: "call_1",
		});
	});

	it("keys a subagent pane by its child chat, with the delegating chat when known", () => {
		expect(subagentPaneId("ses_child")).toBe("subagent:ses_child");
		expect(subagentPaneMetadata("ses_a")).toEqual({ chatId: "ses_a" });
		expect(subagentPaneMetadata(null)).toEqual({});
	});

	it("reads a subagent pane's child from its object, or from an adopted pane's metadata", () => {
		const current = { metadata: { chatId: "ses_a" }, object: chatPaneObject("ses_child") };
		expect(subagentPaneChildChatId(current)).toBe("ses_child");
		expect(subagentPaneParentChatId(current)).toBe("ses_a");
		const adopted = { metadata: { childSessionId: "ses_child", chatId: "ses_a" } };
		expect(subagentPaneChildChatId(adopted)).toBe("ses_child");
		expect(subagentPaneParentChatId({ metadata: {} })).toBeNull();
	});
});
