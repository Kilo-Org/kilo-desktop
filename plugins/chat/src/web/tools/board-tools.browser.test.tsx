import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";

import { chatPaneObject, SWARM_PANE_KIND, swarmPaneId } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { expandAll, toolPart } from "../../test/transcript";
import { useSwarmBoardStore } from "../swarm/swarm-board-store";

const WAIT = { timeout: 15_000 };

afterEach(() => {
	vi.restoreAllMocks();
});

const post = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: 1,
	from: "main",
	to: "ses_c1",
	type: "ASK",
	body: `Post ${id}`,
	...patch,
});

/** Kilo's `board_post` output: the posted message as JSON. */
const posted = (id: string, to: string, body: string) =>
	JSON.stringify({ id, timestamp: 1, from: "main", to, type: "ASK", body });

const boardPost = (
	callId: string,
	input: { to: string; body: string },
	state: Record<string, unknown> = {},
) => toolPart("board_post", { input: { type: "ASK", ...input }, ...state }, callId);

async function showTranscript(
	parts: Record<string, unknown>[],
	board: SwarmBoard,
	{ running = false } = {},
) {
	const server = new FakeKiloServer();
	const settled = assistantMessage("ses_a", "msg_2", "msg_1", parts);
	// A turn still running: no completion time, no finish.
	const { finish: _finish, ...unfinished } = settled.info;
	const reply = running ? { ...settled, info: { ...unfinished, time: { created: 1 } } } : settled;
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Map conda",
		messages: [userMessage("ses_a", "msg_1", "Coordinate the team"), reply],
	});
	server.addChat({ id: "ses_c1", directory: "/projects/app", title: "Worker", messages: [] });
	if (running) server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [
			chatSummary("ses_a", { title: "Map conda" }),
			chatSummary("ses_c1", { parentId: "ses_a", title: "Map bridge RPC (@explore subagent)" }),
		],
		boards: { ses_a: board },
	});
	await expect.element(page.getByText("Coordinate the team").first(), WAIT).toBeVisible();
	return host;
}

const rows = () => page.getByTestId("kilo-board-post");

describe("board tool calls in the transcript", () => {
	it("shows a post with its recipient, first line and number on the board", async () => {
		await showTranscript(
			[
				boardPost(
					"call_p1",
					{ to: "ses_c1", body: "Check the RPC table\nThen report back" },
					{ output: posted("m2", "ses_c1", "Check the RPC table") },
				),
			],
			{
				ownerChatId: "ses_a",
				revision: 7,
				messages: [post("m1"), post("m2"), post("m3")],
				hasMore: true,
			},
		);

		const row = rows().first();
		await expect.element(row, WAIT).toMatchTextContent(/Posted to board/);
		await expect
			.element(row.getByTestId("kilo-board-post-recipient"))
			.toHaveTextContent("→ Map bridge RPC");
		await expect.element(row.getByText("Check the RPC table")).toBeVisible();
		expect(row.element().textContent).not.toContain("Then report back");
		await expect.element(row.getByTestId("kilo-board-post-number"), WAIT).toHaveTextContent("#6");
	});

	it("leaves the number out when the post isn't on the board's newest page", async () => {
		const host = await showTranscript(
			[
				boardPost(
					"call_p2",
					{ to: "ALL", body: "Heads up" },
					{ output: posted("m_old", "ALL", "Heads up") },
				),
			],
			{ ownerChatId: "ses_a", revision: 3, messages: [post("m1")], hasMore: true },
		);

		const row = rows().first();
		await expect
			.element(row.getByTestId("kilo-board-post-recipient"), WAIT)
			.toHaveTextContent("→ Everyone");
		await vi.waitFor(() => expect(host.core.calls.boardReads).toHaveBeenCalled());
		await expect.element(row.getByRole("button")).toBeVisible();
		expect(row.getByTestId("kilo-board-post-number").query()).toBeNull();
	});

	it("says it is posting while the call runs", async () => {
		await showTranscript(
			[
				boardPost(
					"call_p3",
					{ to: "main", body: "Done" },
					{ status: "running", output: undefined },
				),
			],
			{ ownerChatId: "ses_a", revision: 0, messages: [], hasMore: false },
			{ running: true },
		);

		const row = rows().first();
		await expect.element(row, WAIT).toHaveAttribute("data-status", "running");
		await expect.element(row).toMatchTextContent(/Posting…/);
		await expect
			.element(row.getByTestId("kilo-board-post-recipient"))
			.toHaveTextContent("→ Main agent");
	});

	it("opens the team's Swarm Board on the post", async () => {
		const requestFocus = vi.spyOn(useSwarmBoardStore.getState(), "requestFocus");
		const host = await showTranscript(
			[
				boardPost(
					"call_p4",
					{ to: "ses_c1", body: "Open me" },
					{ output: posted("m9", "ses_c1", "Open me") },
				),
			],
			{ ownerChatId: "ses_a", revision: 9, messages: [post("m9")], hasMore: true },
		);

		await expect
			.element(rows().first().getByTestId("kilo-board-post-number"), WAIT)
			.toHaveTextContent("#9");
		await rows().first().getByRole("button").click();

		expect(requestFocus).toHaveBeenCalledWith("ses_a", { kind: "post", messageId: "m9" });
		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: SWARM_PANE_KIND,
				paneId: swarmPaneId("ses_a"),
				object: chatPaneObject("ses_a"),
			}),
		);
	});

	it("shows board reads as a muted line without what they read", async () => {
		await showTranscript(
			[
				toolPart("board_read", { output: "SECRET BOARD CONTENT" }, "call_r1"),
				toolPart("board_read", { output: "SECRET BOARD CONTENT" }, "call_r2"),
			],
			{ ownerChatId: "ses_a", revision: 0, messages: [], hasMore: false },
		);

		await expandAll();

		await expect
			.element(page.getByTestId("kilo-board-read").first(), WAIT)
			.toHaveTextContent("Read the board");
		expect(document.body.textContent).not.toContain("SECRET BOARD CONTENT");
	});
});
