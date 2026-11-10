import { describe, expect, it } from "vitest";

import {
	agentPaneChatId,
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

describe("agentPaneChatId", () => {
	it("prefers the chat the pane names, then the work session's first, else none", () => {
		expect(
			agentPaneChatId({ metadata: {}, object: chatPaneObject("ses_b") }, { chatIds: ["ses_a"] }),
		).toBe("ses_b");
		expect(agentPaneChatId({ metadata: { chatId: "ses_b" } }, { chatIds: ["ses_a"] })).toBe(
			"ses_b",
		);
		expect(agentPaneChatId({ metadata: {} }, { chatIds: ["ses_a", "ses_c"] })).toBe("ses_a");
		expect(agentPaneChatId({ metadata: {} }, { chatIds: [] })).toBeNull();
		expect(agentPaneChatId({ metadata: {} }, undefined)).toBeNull();
	});

	describe("with the work session's other agent panes", () => {
		const agent = (id: string, chatId?: string) => ({
			id,
			kind: "kilo.chat/agent",
			metadata: {},
			...(chatId ? { object: chatPaneObject(chatId) } : {}),
		});
		const workSession = { chatIds: ["ses_a", "ses_b"] };

		it("gives the work session's first chat to its first agent pane, when that names none", () => {
			const panes = [agent("p1"), agent("p2")];
			expect(agentPaneChatId(panes[0]!, workSession, panes)).toBe("ses_a");
			expect(agentPaneChatId(panes[1]!, workSession, panes)).toBeNull();
		});

		it("leaves a pane added beside an agent pane a draft", () => {
			const panes = [agent("p1", "ses_b"), agent("p2")];
			expect(agentPaneChatId(panes[1]!, workSession, panes)).toBeNull();
		});

		it("leaves the first chat to the pane that names it", () => {
			const panes = [agent("p1"), agent("p2", "ses_a")];
			expect(agentPaneChatId(panes[0]!, workSession, panes)).toBeNull();
			expect(agentPaneChatId(panes[1]!, workSession, panes)).toBe("ses_a");
		});

		it("counts an adopted pane naming the chat in its metadata", () => {
			const panes = [
				agent("p1"),
				{ id: "p2", kind: "kilo.chat/agent", metadata: { chatId: "ses_a" } },
			];
			expect(agentPaneChatId(panes[0]!, workSession, panes)).toBeNull();
		});

		it("ignores panes of other kinds", () => {
			const panes = [{ id: "t", kind: "kilo.terminal/terminal", metadata: {} }, agent("p1")];
			expect(agentPaneChatId(panes[1]!, workSession, panes)).toBe("ses_a");
		});
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
