import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";
import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	SWARM_PANE_KIND,
	swarmPaneId,
	subagentPaneId,
	subagentPaneMetadata,
} from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { useSwarmBoardStore } from "./swarm-board-store";
import { WORKER_COLORS } from "./swarm-colors";
import { toolPart } from "../../test/transcript";

const WAIT = { timeout: 15_000 };

const message = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: Date.UTC(2026, 10, 11, 10, Number(id.slice(1))),
	from: "ses_c1",
	to: "main",
	fromLabel: "Map bridge RPC",
	type: "RESULT",
	body: `Finding ${id}`,
	...patch,
});

const board = (messages: BoardMessage[], patch: Partial<SwarmBoard> = {}): SwarmBoard => ({
	ownerChatId: "ses_a",
	revision: 1,
	messages,
	hasMore: false,
	...patch,
});

function delegatingServer() {
	const fake = new FakeKiloServer();
	fake.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Map conda",
		messages: [
			userMessage("ses_a", "msg_1", "Map the bridge"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				toolPart(
					"task",
					{
						status: "completed",
						input: { description: "Map bridge RPC", subagent_type: "explore" },
						output: "<task_result>Done</task_result>",
						metadata: { sessionId: "ses_c1" },
					},
					"call_t1",
				),
			]),
		],
	});
	fake.addChat({ id: "ses_c1", directory: "/projects/app", title: "Map bridge RPC", messages: [] });
	return fake;
}

const swarmPane = (rootChatId = "ses_a"): Pane => ({
	id: swarmPaneId(rootChatId),
	kind: SWARM_PANE_KIND,
	title: "Swarm board",
	metadata: {},
	object: chatPaneObject(rootChatId),
	ordinal: 1,
});

const TEAM = [
	chatSummary("ses_a", { title: "Map conda" }),
	chatSummary("ses_c1", { parentId: "ses_a", title: "Map bridge RPC", createdAt: 2 }),
];

async function showBoard(options: Parameters<typeof renderChat>[0] = {}) {
	return renderChat({
		server: delegatingServer(),
		pane: swarmPane(),
		chats: TEAM,
		boards: {
			ses_a: board([
				message("m1"),
				message("m2", { type: "ASK", from: "main", to: "ses_c1", replyTo: "m1" }),
			]),
		},
		...options,
	});
}

const pane = () => page.getByTestId("swarm-board");
const boardAction = async (action: string) => {
	await pane().getByTestId("swarm-board-actions").click();
	await page.getByTestId(action).click();
};
/** A post body's text (the results digest repeats first lines). */
const postText = (text: string) =>
	pane().getByTestId("swarm-board-message").getByText(text, { exact: true });

describe("the Swarm Board pane", () => {
	it("shows the board's posts, named by the team's titles, and the team in Members", async () => {
		await showBoard({
			boards: {
				ses_a: board(
					[
						message("m1"),
						message("m2", { type: "ASK", from: "main", to: "ses_c1", replyTo: "m1" }),
					],
					{ revision: 2 },
				),
			},
		});

		const senders = pane().getByTestId("swarm-board-message-sender");
		await expect.element(senders.nth(0), WAIT).toHaveTextContent("Map bridge RPC");
		await expect.element(senders.nth(1)).toHaveTextContent("Main agent");
		await expect.element(postText("Finding m1")).toBeVisible();
		await expect
			.element(pane().getByTestId("swarm-board-message-reply"))
			.toHaveTextContent("Reply to #1");
		await pane().getByTestId("swarm-team-toggle").click();
		const members = pane().getByTestId("swarm-member");
		await expect.element(members.nth(0)).toHaveAttribute("data-chat-id", "ses_c1");
	});
	it("opens an agent's transcript from Members", async () => {
		const host = await showBoard();
		await pane().getByTestId("swarm-team-toggle").click({ timeout: WAIT.timeout });
		const member = pane().getByTestId("swarm-member").nth(0);
		await member.getByTestId("swarm-member-toggle").click();

		await member.getByTestId("swarm-member-open").click();

		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: SUBAGENT_PANE_KIND,
				paneId: subagentPaneId("ses_c1"),
				object: chatPaneObject("ses_c1"),
			}),
		);
	});
	it("pages back to older messages", async () => {
		const messages = Array.from({ length: 60 }, (_, index) => message(`m${index + 1}`));
		await showBoard({ boards: { ses_a: board(messages) } });

		await expect.element(postText("Finding m60"), WAIT).toBeVisible();
		expect(document.body.textContent).not.toContain("Finding m10 ");
		await pane().getByTestId("swarm-board-older").click();

		await expect.element(postText("Finding m1"), WAIT).toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-older")).not.toBeInTheDocument();
	});

	it("clears the board at the revision it shows after asking", async () => {
		const host = await showBoard();

		await expect.element(postText("Finding m2"), WAIT).toBeVisible();
		await boardAction("swarm-board-reset");
		await page.getByTestId("swarm-board-reset-confirm").click();

		await expect.element(pane().getByTestId("swarm-board-empty"), WAIT).toBeVisible();
		expect(host.core.calls.resetBoard).toHaveBeenCalledWith({ chatId: "ses_a", revision: 1 });
	});

	it("says the subagents finished without posting, instead of waiting for posts", async () => {
		await showBoard({
			chats: [
				chatSummary("ses_a", { title: "Map conda" }),
				chatSummary("ses_c1", {
					parentId: "ses_a",
					title: "Map bridge RPC",
					createdAt: 2,
					activity: {
						status: "idle",
						completedAt: 3,
						pendingPermissionIds: [],
						pendingQuestionIds: [],
					},
				}),
			],
			boards: { ses_a: board([]) },
		});

		const empty = pane().getByTestId("swarm-board-empty");
		await expect.element(empty.getByText("No posts on this board"), WAIT).toBeVisible();
		await expect.element(empty.getByText(/The subagent finished without posting\./)).toBeVisible();
		await expect.element(empty.getByTestId("swarm-board-empty-open-chat")).toBeVisible();
	});

	it("does not clear messages arriving behind the confirmation dialog", async () => {
		const host = await showBoard({ boardEvents: true });
		await expect.element(postText("Finding m2"), WAIT).toBeVisible();
		await pane().getByTestId("swarm-board-actions").click();
		await page.getByTestId("swarm-board-reset").click();
		host.core.setBoard(
			"ses_a",
			board([message("m1"), message("m2"), message("m3")], { revision: 2 }),
		);
		host.core.announceBoard("ses_a");
		await expect.element(postText("Finding m3"), WAIT).toBeInTheDocument();
		await page.getByTestId("swarm-board-reset-confirm").click();
		await expect.element(page.getByText("The board changed")).toBeVisible();
		expect(host.core.calls.resetBoard).toHaveBeenCalledWith({ chatId: "ses_a", revision: 1 });
		await expect.element(postText("Finding m3")).toBeVisible();
	});

	it("reads the board again instead of clearing it when it changed meanwhile", async () => {
		const host = await showBoard();
		await expect.element(postText("Finding m2"), WAIT).toBeVisible();
		host.core.setBoard(
			"ses_a",
			board([message("m1"), message("m2"), message("m3")], { revision: 2 }),
		);

		await boardAction("swarm-board-reset");
		await page.getByTestId("swarm-board-reset-confirm").click();

		await expect.element(postText("Finding m3"), WAIT).toBeVisible();
		await expect.element(page.getByText("The board changed")).toBeVisible();
	});

	it("stops a running background agent from Members", async () => {
		const fake = delegatingServer();
		const host = await showBoard({
			server: fake,
			jobs: {
				ses_a: [
					{
						id: "job_1",
						type: "task",
						status: "running",
						chatId: "ses_c1",
						agent: "explore",
						model: "kilo/anthropic/claude-haiku-4.5",
						startedAt: 1,
					},
				],
			},
		});

		fake.emit("session.status", { sessionID: "ses_c1", status: { type: "busy" } });
		await pane().getByTestId("swarm-team-toggle").click({ timeout: WAIT.timeout });
		const member = pane().getByTestId("swarm-member").nth(0);
		await expect
			.element(member.getByTestId("swarm-member-status"), WAIT)
			.toHaveTextContent("Working");
		await member.getByTestId("swarm-member-toggle").click();
		await member.getByTestId("swarm-member-stop").click();

		await vi.waitFor(() =>
			expect(host.core.calls.cancelJob).toHaveBeenCalledWith({ chatId: "ses_a", jobId: "job_1" }),
		);
	});
	it("reads the board when Kilo announces a change, without polling", async () => {
		const host = await showBoard({ boardEvents: true });
		await expect.element(postText("Finding m2"), WAIT).toBeVisible();
		const reads = host.core.calls.boardReads.mock.calls.length;

		host.core.setBoard(
			"ses_a",
			board([message("m1"), message("m2"), message("m3")], { revision: 2 }),
		);
		host.core.announceBoard("ses_a");

		await expect.element(postText("Finding m3"), WAIT).toBeVisible();
		expect(host.core.calls.boardReads.mock.calls.length).toBe(reads + 1);
	});

	it("shows Kilo's roster when the server has one: who needs you, and a way to stop it", async () => {
		await showBoard({
			teams: {
				ses_a: {
					truncated: false,
					members: [
						{
							chatId: "ses_c1",
							parentChatId: "ses_a",
							agent: "explore",
							title: "Map bridge RPC",
							directory: "/projects/bridge",
							state: "busy",
							background: true,
							live: true,
							attention: ["permission"],
							model: "kilo/anthropic/claude-haiku-4.5",
							startedAt: 2,
						},
					],
				},
			},
		});

		await pane().getByTestId("swarm-team-toggle").click({ timeout: WAIT.timeout });
		const member = pane().getByTestId("swarm-member").nth(0);
		await expect
			.element(member.getByTestId("swarm-member-status"), WAIT)
			.toHaveTextContent("Needs you");
		await member.getByTestId("swarm-member-toggle").click();
		await expect.element(member.getByTestId("swarm-member-stop")).toBeVisible();
	});
	it("folds long posts but the newest, and folds or unfolds any post", async () => {
		const long = `LONG REPORT\n${"detail line\n".repeat(12)}`;
		await showBoard({
			boards: { ses_a: board([message("m1", { body: long }), message("m2", { body: long })]) },
		});

		const posts = pane().getByTestId("swarm-board-message");
		await expect
			.element(posts.nth(0).getByTestId("swarm-board-message-preview"), WAIT)
			.toHaveTextContent("LONG REPORT");
		await expect
			.element(posts.nth(1).getByTestId("swarm-board-message-preview"))
			.not.toBeInTheDocument();

		await posts.nth(0).getByTestId("swarm-board-message-toggle").click();
		await expect
			.element(posts.nth(0).getByTestId("swarm-board-message-preview"))
			.not.toBeInTheDocument();
		await posts.nth(1).getByTestId("swarm-board-message-toggle").click();
		await expect.element(posts.nth(1).getByTestId("swarm-board-message-preview")).toBeVisible();
	});
	it("says when the board isn't available for a chat", async () => {
		await showBoard({ boards: {} });

		const unavailable = pane().getByTestId("swarm-board-unavailable");
		await expect.element(unavailable, WAIT).toBeVisible();
		await expect
			.element(unavailable.getByText("The board isn't available for this chat"))
			.toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-empty")).not.toBeInTheDocument();
	});

	it("is empty before any agent posts", async () => {
		await showBoard({ boards: { ses_a: board([]) } });

		await expect.element(pane().getByTestId("swarm-board-empty"), WAIT).toBeVisible();
		await pane().getByTestId("swarm-board-actions").click();
		await expect
			.element(page.getByTestId("swarm-board-reset"))
			.toHaveAttribute("aria-disabled", "true");
	});
});

describe("the composer's subagent strip", () => {
	it("opens the chat's Swarm Board once it has delegated", async () => {
		// With everyone finished, the swarm shelf stays while a post is unread.
		useSwarmBoardStore.setState({ seen: {} });
		const host = await renderChat({
			server: delegatingServer(),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: TEAM,
			boards: { ses_a: board([message("m1")]) },
		});

		await page.getByTestId("kilo-composer-swarm-board").click({ timeout: WAIT.timeout });

		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: SWARM_PANE_KIND,
				paneId: swarmPaneId("ses_a"),
				object: chatPaneObject("ses_a"),
			}),
		);
	});
});

describe("a worker's pane", () => {
	it("is headed in the worker's board color, and read-only", async () => {
		await renderChat({
			server: delegatingServer(),
			pane: {
				id: subagentPaneId("ses_c1"),
				kind: SUBAGENT_PANE_KIND,
				title: "Map bridge RPC",
				metadata: {},
				object: chatPaneObject("ses_c1"),
				ordinal: 1,
			},
			chats: TEAM,
		});

		const header = page.getByTestId("subagent-pane-header");
		await expect.element(header, WAIT).toBeVisible();
		await expect.element(header).toHaveAttribute("data-color", WORKER_COLORS[0]);

		await expect.element(page.getByTestId("subagent-pane-composer-input")).not.toBeInTheDocument();
	});

	it("takes the board's color from Kilo's roster when kilo.core doesn't list the worker yet", async () => {
		await renderChat({
			server: delegatingServer(),
			pane: {
				id: subagentPaneId("ses_c1"),
				kind: SUBAGENT_PANE_KIND,
				title: "Map bridge RPC",
				metadata: subagentPaneMetadata("ses_a"),
				object: chatPaneObject("ses_c1"),
				ordinal: 1,
			},
			chats: [TEAM[0]!],
			teams: {
				ses_a: {
					truncated: false,
					members: [
						{
							chatId: "ses_c0",
							parentChatId: "ses_a",
							title: "Earlier worker",
							directory: "/projects/app",
							state: "completed",
							background: true,
							live: false,
							attention: [],
							startedAt: 1,
						},
						{
							chatId: "ses_c1",
							parentChatId: "ses_a",
							title: "Map bridge RPC",
							directory: "/projects/app",
							state: "busy",
							background: true,
							live: true,
							attention: [],
							startedAt: 2,
						},
					],
				},
			},
		});

		const header = page.getByTestId("subagent-pane-header");
		await expect.element(header, WAIT).toBeVisible();
		await expect.element(header).toHaveAttribute("data-color", WORKER_COLORS[1]);
	});
});
