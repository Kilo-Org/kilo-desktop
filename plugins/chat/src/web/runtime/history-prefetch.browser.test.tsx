import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	EMPTY_WORK_SESSION_PANES,
	WorkSessionsWindow,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { testWebEntry } from "@kilo-desktop/plugin-work-sessions/testing";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary, workSession } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	idleMessage,
	session,
	text,
	userMessage,
} from "../../test/kilo2/fixtures";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

function chatWith(server: FakeKilo2Server, id: string, answer: string) {
	server.addChat(session(id, { directory: "/projects/app", title: id }), [
		userMessage("Question"),
		assistantMessage([text(answer)]),
		idleMessage(),
	]);
}

async function renderTwoSessions() {
	const server = new FakeKilo2Server();
	chatWith(server, "ses_a", "Answer A");
	chatWith(server, "ses_b", "Answer B");
	const host = await renderChat({
		server,
		workSessionsWeb: testWebEntry,
		workSession: workSession({ id: "wses_a", title: "First", chatIds: ["ses_a"] }),
		otherWorkSessions: [workSession({ id: "wses_b", title: "Second", chatIds: ["ses_b"] })],
		withoutPane: true,
		otherPanes: [agentPane({ id: "pane_a", object: chatPaneObject("ses_a") })],
		otherSessionPanes: {
			wses_b: {
				...EMPTY_WORK_SESSION_PANES,
				panes: [agentPane({ id: "pane_b", object: chatPaneObject("ses_b") })],
				activePaneId: "pane_b",
			},
		},
		chats: [chatSummary("ses_a"), chatSummary("ses_b")],
	});
	await expect.element(page.getByText("Answer A")).toBeVisible();
	const sessionRow = page
		.getByTestId("session-list-item")
		.filter({ hasText: "Second" })
		.getByTestId("session-list-item-trigger");
	const historyReads = () => server.requestsTo("GET", "/api/session/ses_b/message").length;
	return { host, server, sessionRow, historyReads };
}

describe("prefetching a work session's chats", () => {
	it("loads a hovered session's chat ahead, and opening it reads nothing again", async () => {
		const { host, sessionRow, historyReads } = await renderTwoSessions();

		await sessionRow.hover();
		await vi.waitFor(() => expect(historyReads()).toBe(1));
		await host.host.renderer.kernelSdk.domainObjects
			.get(WorkSessionsWindow)!
			.methods.openWorkSession({ workSessionId: "wses_b" });

		await expect.element(page.getByText("Answer B")).toBeVisible();
		expect(historyReads()).toBe(1);
	});

	it("reads the chat again when it changed after it was prefetched", async () => {
		const { host, server, sessionRow, historyReads } = await renderTwoSessions();

		await sessionRow.hover();
		await vi.waitFor(() => expect(historyReads()).toBe(1));
		server.emit("session.renamed", { title: "Renamed" }, "ses_b");
		await host.host.renderer.kernelSdk.domainObjects
			.get(WorkSessionsWindow)!
			.methods.openWorkSession({ workSessionId: "wses_b" });

		await expect.element(page.getByText("Answer B")).toBeVisible();
		await vi.waitFor(() => expect(historyReads()).toBe(2));
	});
});
