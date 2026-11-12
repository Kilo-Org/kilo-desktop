import { describe, expect, it } from "vitest";

import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import type { Pane } from "../../contracts";
import { closedChatsOf } from "./closed-chats";

const AGENT = "kilo.chat/agent";
const chatRef = (id: string) => ({ type: "kilo.core/chat" as const, id });

const summary = (id: string, patch: Partial<ChatSummary> = {}) =>
	({ id, parentId: null, workSessionId: null, updatedAt: 0, ...patch }) as ChatSummary;

const agentPane = (id: string, chatId?: string): Pane => ({
	id,
	kind: AGENT,
	title: id,
	metadata: {},
	ordinal: 1,
	...(chatId ? { object: chatRef(chatId) } : {}),
});

const openInAgent = (ref: { type: string }) => (ref.type === "kilo.core/chat" ? AGENT : undefined);

describe("a work session's closed chats", () => {
	it("lists its own chats no pane shows, most recently active first", () => {
		const chats = {
			ses_old: summary("ses_old", { updatedAt: 1 }),
			ses_new: summary("ses_new", { updatedAt: 3 }),
			ses_shown: summary("ses_shown", { updatedAt: 5 }),
			ses_stamped: summary("ses_stamped", { updatedAt: 2, workSessionId: "wses_1" }),
			ses_child: summary("ses_child", { updatedAt: 9, parentId: "ses_new" }),
			ses_elsewhere: summary("ses_elsewhere", { updatedAt: 8, workSessionId: "wses_2" }),
		};

		const closed = closedChatsOf(
			{ id: "wses_1", chatIds: ["ses_old", "ses_new", "ses_shown", "ses_child"] },
			chats,
			[agentPane("p1", "ses_shown"), agentPane("p2")],
			openInAgent,
		);

		expect(closed).toEqual([
			{ kind: AGENT, object: chatRef("ses_new") },
			{ kind: AGENT, object: chatRef("ses_stamped") },
			{ kind: AGENT, object: chatRef("ses_old") },
		]);
	});

	it("keeps a listed chat kilo.core doesn't know yet, last, and leaves out chats nothing opens", () => {
		const chats = { ses_a: summary("ses_a", { updatedAt: 1 }) };
		const session = { id: "wses_1", chatIds: ["ses_unknown", "ses_a"] };

		expect(closedChatsOf(session, chats, [], openInAgent)).toEqual([
			{ kind: AGENT, object: chatRef("ses_a") },
			{ kind: AGENT, object: chatRef("ses_unknown") },
		]);
		expect(closedChatsOf(session, chats, [], () => undefined)).toEqual([]);
	});
});
