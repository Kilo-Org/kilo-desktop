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

	describe("with the session's other agent panes", () => {
		const agent = (id: string, chatId?: string) => ({
			id,
			kind: "kilo.chat/agent",
			metadata: chatId ? { chatId } : {},
		});
		const session = { chatIds: ["ses_a", "ses_b"] };

		it("gives the session's first chat to its first agent pane, when that names none", () => {
			const panes = [agent("p1"), agent("p2")];
			expect(agentPaneChatId(panes[0]!, session, panes)).toBe("ses_a");
			expect(agentPaneChatId(panes[1]!, session, panes)).toBeNull();
		});

		it("leaves a pane added beside an agent pane a draft", () => {
			const panes = [agent("p1", "ses_b"), agent("p2")];
			expect(agentPaneChatId(panes[1]!, session, panes)).toBeNull();
		});

		it("leaves the first chat to the pane that names it", () => {
			const panes = [agent("p1"), agent("p2", "ses_a")];
			expect(agentPaneChatId(panes[0]!, session, panes)).toBeNull();
			expect(agentPaneChatId(panes[1]!, session, panes)).toBe("ses_a");
		});

		it("ignores panes of other kinds", () => {
			const panes = [{ id: "t", kind: "kilo.terminal/terminal", metadata: {} }, agent("p1")];
			expect(agentPaneChatId(panes[1]!, session, panes)).toBe("ses_a");
		});
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
