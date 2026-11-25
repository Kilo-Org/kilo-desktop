import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";
import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	SWARM_PANE_KIND,
	subagentPaneId,
	swarmConversationMetadata,
	swarmConversationPaneId,
	swarmPaneId,
} from "../../contracts";
import { chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { toolPart } from "../../test/transcript";
import { useSwarmBoardStore } from "./swarm-board-store";

const WAIT = { timeout: 15_000 };
const AT = (minute: number) => Date.UTC(2026, 10, 11, 10, minute);

const post = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: AT(Number(id.replace(/\D/g, ""))),
	from: "ses_c1",
	to: "main",
	type: "INFO",
	body: `Finding ${id}`,
	...patch,
});

const board = (messages: BoardMessage[], patch: Partial<SwarmBoard> = {}): SwarmBoard => ({
	ownerChatId: "ses_a",
	revision: messages.length,
	messages,
	hasMore: false,
	...patch,
});

/** The chats `working` are busy, as the server reports them. */
function delegatingServer(working: readonly string[] = ["ses_c1", "ses_c2"]) {
	const fake = new FakeKiloServer();
	fake.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Migrate invoices to v2",
		messages: [
			userMessage("ses_a", "msg_1", "Migrate the invoice service"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				toolPart(
					"task",
					{
						status: "running",
						input: { description: "Mapper", subagent_type: "explore" },
						metadata: { sessionId: "ses_c1" },
					},
					"call_t1",
				),
				toolPart(
					"task",
					{
						status: "running",
						input: { description: "Webhooks", subagent_type: "general" },
						metadata: { sessionId: "ses_c2" },
					},
					"call_t2",
				),
			]),
		],
	});
	fake.addChat({ id: "ses_c1", directory: "/projects/app", title: "Mapper", messages: [] });
	fake.addChat({ id: "ses_c2", directory: "/projects/app", title: "Webhooks", messages: [] });
	for (const sessionID of working)
		fake.emit("session.status", { sessionID, status: { type: "busy" } });
	return fake;
}

const swarmPane = (metadata: Record<string, string> = {}, id = swarmPaneId("ses_a")): Pane => ({
	id,
	kind: SWARM_PANE_KIND,
	title: "Swarm Board",
	metadata,
	object: chatPaneObject("ses_a"),
	ordinal: 1,
});

const busy = { status: "busy" as const, pendingPermissionIds: [], pendingQuestionIds: [] };
const idle = (completedAt: number) => ({
	status: "idle" as const,
	completedAt,
	pendingPermissionIds: [],
	pendingQuestionIds: [],
});

const TEAM = (activity: { c1?: object; c2?: object } = {}) => [
	chatSummary("ses_a", { title: "Migrate invoices to v2" }),
	chatSummary("ses_c1", {
		parentId: "ses_a",
		title: "Mapper",
		createdAt: AT(0),
		activity: { ...busy, ...activity.c1 },
	}),
	chatSummary("ses_c2", {
		parentId: "ses_a",
		title: "Webhooks",
		createdAt: AT(1),
		activity: { ...busy, ...activity.c2 },
	}),
];

const POSTS = [
	post("m1", { from: "main", to: "ALL", body: "Plan: Mapper maps call sites first." }),
	post("m2", { from: "ses_c1", to: "ses_c2", body: "Found 14 call sites." }),
	post("m3", { from: "ses_c2", to: "ses_c1", type: "HOLD", body: "Hold off on retry.ts." }),
];

async function showBoard(options: Parameters<typeof renderChat>[0] = {}) {
	return renderChat({
		server: delegatingServer(),
		pane: swarmPane(),
		chats: TEAM(),
		boards: { ses_a: board(POSTS) },
		...options,
	});
}

// Filters and focus requests live per window; each test starts with none.
beforeEach(() => useSwarmBoardStore.setState({ filters: {}, focus: {} }));

const pane = () => page.getByTestId("swarm-board");
/** An element's text contains `text` (toHaveTextContent matches the whole text here). */
const textOf = (locator: ReturnType<typeof pane>) =>
	expect.poll(() => locator.element().textContent ?? "", WAIT);
const posts = () => pane().getByTestId("swarm-board-message");
const boardAction = async (action: string) => {
	await pane().getByTestId("swarm-board-actions").click();
	await page.getByTestId(action).click();
};

describe("the Swarm Board as a live conversation", () => {
	it("shows posts as messages: sender → recipient, #n and time, blocking posts tagged", async () => {
		await showBoard();

		await expect.element(posts().nth(2), WAIT).toBeVisible();
		await expect
			.element(posts().nth(0).getByTestId("swarm-board-message-sender"))
			.toHaveTextContent("Main agent");
		await expect
			.element(posts().nth(0).getByTestId("swarm-board-message-recipient"))
			.toHaveTextContent("everyone");
		await expect
			.element(posts().nth(1).getByTestId("swarm-board-message-recipient"))
			.toHaveTextContent("Webhooks");
		await expect.element(posts().nth(1).getByText(/#2 ·/)).toBeVisible();
		await expect
			.element(posts().nth(2).getByTestId("swarm-board-message-tag"))
			.toHaveTextContent("Asked to wait");
		await expect
			.element(posts().nth(1).getByTestId("swarm-board-message-tag"))
			.not.toBeInTheDocument();
	});

	it("names the swarm's chat in the header, with its status, and sums up the team", async () => {
		const host = await showBoard();

		await textOf(pane().getByTestId("swarm-board-chat")).toContain("Migrate invoices to v2");
		await expect
			.element(pane().getByTestId("swarm-board-status"))
			.toHaveAttribute("data-status", "live");
		await expect.element(pane().getByTestId("swarm-team-summary")).toHaveTextContent("2 working");
		await expect.element(pane().getByTestId("swarm-team")).not.toBeInTheDocument();
		await pane().getByTestId("swarm-team-toggle").click();
		await expect.element(pane().getByTestId("swarm-members")).toBeVisible();
		await pane().getByTestId("swarm-board-chat").click();
		await vi.waitFor(() =>
			expect(host.sessions.calls.open).toHaveBeenCalledWith(
				expect.objectContaining({ object: chatPaneObject("ses_a") }),
			),
		);
	});

	it("answers a subagent's question in place, sent to that agent", async () => {
		const host = await showBoard();
		host.server.askQuestion("ses_c2", {
			id: "que_1",
			questions: [
				{
					question: "How should I handle the public event?",
					header: "Event",
					options: [{ label: "Keep invoice.paid" }, { label: "Emit both" }],
					custom: false,
				},
			],
		});

		const item = pane().getByTestId("swarm-board-needs-you");
		await expect
			.element(item.getByText("How should I handle the public event?"), WAIT)
			.toBeVisible();
		await expect.element(item.getByText("Webhooks")).toBeVisible();
		await expect
			.element(pane().getByTestId("swarm-board-status"))
			.toHaveAttribute("data-status", "needs-you");
		document.querySelector<HTMLInputElement>('input[value="Keep invoice.paid"]')!.click();
		await item.getByRole("button", { name: "Send to Webhooks" }).click();

		await vi.waitFor(() =>
			expect(host.agent.calls.replyQuestion).toHaveBeenCalledWith({
				chatId: "ses_c2",
				questionId: "que_1",
				answers: [["Keep invoice.paid"]],
			}),
		);
	});

	it("shows a failed agent's error with a way to its transcript", async () => {
		await showBoard({
			server: delegatingServer(["ses_c1"]),
			chats: TEAM({ c2: idle(AT(9)) }),
			jobs: {
				ses_a: [
					{
						id: "job_2",
						type: "task",
						status: "error",
						chatId: "ses_c2",
						startedAt: AT(1),
						completedAt: AT(9),
						error: "Provider rate limit after 3 retries.",
					},
				],
			},
		});

		const card = pane().getByTestId("swarm-board-failed");
		await textOf(card).toContain("Webhooks failed");
		await textOf(card).toContain("Provider rate limit after 3 retries.");
		await expect.element(card.getByTestId("swarm-board-failed-open")).toBeVisible();
	});

	it("marks the end of the swarm once every agent stopped", async () => {
		await showBoard({
			server: delegatingServer([]),
			chats: TEAM({ c1: idle(AT(12)), c2: idle(AT(18)) }),
		});

		await textOf(pane().getByTestId("swarm-board-done")).toContain("Swarm done");
		await textOf(pane().getByTestId("swarm-board-done")).toContain("2 agents");
		await expect
			.element(pane().getByTestId("swarm-board-status"))
			.toHaveAttribute("data-status", "done");
	});

	it("says agents are working quietly before anyone posts, with a way to Members", async () => {
		await showBoard({ boards: { ses_a: board([]) } });

		const empty = pane().getByTestId("swarm-board-empty");
		await expect.element(empty.getByText("2 agents are working quietly"), WAIT).toBeVisible();
		await empty.getByTestId("swarm-board-empty-members").click();
		await expect.element(pane().getByTestId("swarm-members")).toBeVisible();
	});

	it("says the subagents finished without posting", async () => {
		await showBoard({
			server: delegatingServer([]),
			chats: TEAM({ c1: idle(AT(3)), c2: idle(AT(4)) }),
			boards: { ses_a: board([]) },
		});

		const empty = pane().getByTestId("swarm-board-empty");
		await expect.element(empty.getByText("No posts on this board"), WAIT).toBeVisible();
		await expect.element(empty.getByTestId("swarm-board-empty-open-chat")).toBeVisible();
	});

	it("opens an agent beside the board, which narrows to that agent's posts", async () => {
		const host = await showBoard();

		await posts().nth(1).getByTestId("swarm-board-message-sender").click();

		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: SUBAGENT_PANE_KIND,
				paneId: subagentPaneId("ses_c1"),
			}),
		);
		await textOf(pane().getByTestId("swarm-board-agent-filter")).toContain("Mapper");
		await expect.poll(() => posts().all().length).toBe(2);
		await pane().getByTestId("swarm-board-agent-filter-clear").click();
		await expect.poll(() => posts().all().length).toBe(3);
	});

	it("jumps to a post an agent cites as #n", async () => {
		await showBoard({
			boards: {
				ses_a: board([...POSTS, post("m4", { from: "ses_c1", body: "Done, per #2." })]),
			},
		});

		const ref = posts().nth(3).getByRole("button", { name: "Show post #2" });
		await expect.element(ref, WAIT).toBeVisible();
		await ref.click();
		await expect.element(posts().nth(1)).toHaveFocus();
	});

	it("searches posts, agents and #refs, with quick views, once the board is busy", async () => {
		const many = Array.from({ length: 24 }, (_, index) =>
			post(`m${index + 1}`, index === 5 ? { type: "VETO", to: "ses_c2", body: "No." } : {}),
		);
		await showBoard({ boards: { ses_a: board(many) } });

		const search = pane().getByTestId("swarm-board-search-input");
		await expect.element(search, WAIT).toBeVisible();
		await search.fill("#7");
		await expect.poll(() => posts().all().length).toBe(1);
		await textOf(posts().nth(0)).toContain("Finding m7");
		await search.fill("");
		await pane().getByTestId("swarm-board-chip").filter({ hasText: "Blocking" }).click();
		await expect.poll(() => posts().all().length).toBe(1);
		await expect.element(posts().nth(0)).toHaveAttribute("data-type", "VETO");
	});

	it("hides search on a small board", async () => {
		await showBoard();
		await expect.element(posts().nth(0), WAIT).toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-search")).not.toBeInTheDocument();
	});

	it("shows what another surface asked for: a post by id", async () => {
		await showBoard();
		await expect.element(posts().nth(2), WAIT).toBeVisible();

		useSwarmBoardStore.getState().requestFocus("ses_a", { kind: "post", messageId: "m1" });

		await expect.element(posts().nth(0), WAIT).toHaveFocus();
		expect(useSwarmBoardStore.getState().focus).toEqual({});
	});
});

describe("Swarm Board actions", () => {
	it("stops every running agent after asking", async () => {
		const job = (id: string, chatId: string) => ({
			id,
			type: "task" as const,
			status: "running" as const,
			chatId,
			startedAt: AT(0),
		});
		const host = await showBoard({
			jobs: { ses_a: [job("job_1", "ses_c1"), job("job_2", "ses_c2")] },
		});

		await expect.element(posts().nth(0), WAIT).toBeVisible();
		await boardAction("swarm-board-stop-all");
		await page.getByTestId("swarm-board-stop-all-confirm").click();

		await vi.waitFor(() => expect(host.core.calls.cancelJob).toHaveBeenCalledTimes(2));
		expect(host.core.calls.cancelJob).toHaveBeenCalledWith({ chatId: "ses_a", jobId: "job_2" });
	});

	it("stops one working agent from its post", async () => {
		const host = await showBoard({
			jobs: {
				ses_a: [
					{ id: "job_1", type: "task", status: "running", chatId: "ses_c1", startedAt: AT(0) },
				],
			},
		});

		await posts().nth(1).getByTestId("swarm-board-message-stop").click();
		await vi.waitFor(() =>
			expect(host.core.calls.cancelJob).toHaveBeenCalledWith({ chatId: "ses_a", jobId: "job_1" }),
		);
	});

	it("goes to the main chat from the menu", async () => {
		const host = await showBoard();

		await expect.element(posts().nth(0), WAIT).toBeVisible();
		await boardAction("swarm-board-open-chat");
		await vi.waitFor(() =>
			expect(host.sessions.calls.open).toHaveBeenCalledWith(
				expect.objectContaining({ object: chatPaneObject("ses_a") }),
			),
		);
	});

	it("opens a conversation between two agents in its own tab, showing only their posts", async () => {
		await showBoard({
			pane: swarmPane(
				swarmConversationMetadata("ses_c1", "ses_c2"),
				swarmConversationPaneId("ses_a", "ses_c1", "ses_c2"),
			),
		});

		await expect
			.element(pane().getByTestId("swarm-board-title"), WAIT)
			.toHaveTextContent("Mapper ↔ Webhooks");
		await expect.poll(() => posts().all().length).toBe(2);
		await expect.element(pane().getByTestId("swarm-team-toggle")).not.toBeInTheDocument();
	});

	it("filters the board from the graph", async () => {
		await showBoard();
		await expect.element(posts().nth(0), WAIT).toBeVisible();
		await boardAction("swarm-board-graph");

		await pane()
			.getByTestId("swarm-graph-node")
			.and(page.getByRole("button", { name: "Filter the board to Webhooks" }))
			.click();

		await textOf(pane().getByTestId("swarm-board-agent-filter")).toContain("Webhooks");
		await userEvent.keyboard("{Escape}");
	});
});
