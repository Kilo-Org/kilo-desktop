import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";
import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import { chatPaneObject, SWARM_PANE_KIND, swarmPaneId } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { toolPart } from "../../test/transcript";
import { EMPTY_FILTER } from "./board-insights";
import { useSwarmBoardStore } from "./swarm-board-store";

const WAIT = { timeout: 15_000 };
const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 16, 9, 0);

const message = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: START + Number(id.slice(1)) * MINUTE,
	from: "ses_c1",
	to: "main",
	type: "INFO",
	body: `Finding ${id}`,
	...patch,
});

const board = (messages: BoardMessage[]): SwarmBoard => ({
	ownerChatId: "ses_a",
	revision: messages.length,
	messages,
	hasMore: false,
});

function delegatingServer() {
	const fake = new FakeKiloServer();
	fake.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Map conda",
		messages: [
			userMessage("ses_a", "msg_1", "Map it"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				toolPart(
					"task",
					{
						status: "completed",
						input: { description: "Bridge RPC", subagent_type: "explore" },
						output: "<task_result>Done</task_result>",
						metadata: { sessionId: "ses_c1" },
					},
					"call_t1",
				),
			]),
		],
	});
	fake.addChat({ id: "ses_c1", directory: "/projects/app", title: "Bridge RPC", messages: [] });
	fake.addChat({ id: "ses_c2", directory: "/projects/app", title: "Desktop UI", messages: [] });
	return fake;
}

const TEAM = [
	chatSummary("ses_a", { title: "Map conda", createdAt: START }),
	chatSummary("ses_c1", { parentId: "ses_a", title: "Bridge RPC", createdAt: START + MINUTE }),
	chatSummary("ses_c2", { parentId: "ses_a", title: "Desktop UI", createdAt: START + 2 * MINUTE }),
];

const swarmPane = (): Pane => ({
	id: swarmPaneId("ses_a"),
	kind: SWARM_PANE_KIND,
	title: "Swarm board",
	metadata: {},
	object: chatPaneObject("ses_a"),
	ordinal: 1,
});

const POSTS = [
	message("m1", { type: "RESULT", body: "Bridge exposes `count_envs`" }),
	message("m2", { from: "ses_c2", type: "ASK", body: "Which schema does count_envs return?" }),
	message("m3", { from: "main", to: "ses_c1", type: "ASK", body: "Are you blocked?" }),
	message("m4", { type: "INFO", to: "ses_c2", replyTo: "m2", body: "It returns { count }" }),
	message("m5", { from: "ses_c2", type: "RESULT", body: "UI shows the count" }),
];

const pane = () => page.getByTestId("swarm-board");
/** An element's text, polled (toHaveTextContent is unreliable here). */
const textOf = (locator: ReturnType<typeof pane>) => () => locator.element().textContent ?? "";
const posts = () => pane().getByTestId("swarm-board-message");
/** Narrows the board to one agent's posts, as opening that agent does. */
const filterTo = (chatId: string) =>
	useSwarmBoardStore.getState().setFilter("ses_a", { ...EMPTY_FILTER, agents: new Set([chatId]) });

function showBoard(options: Parameters<typeof renderChat>[0] = {}) {
	return renderChat({
		server: delegatingServer(),
		pane: swarmPane(),
		chats: TEAM,
		boards: { ses_a: board(POSTS) },
		...options,
	});
}

beforeEach(() => {
	localStorage.clear();
	useSwarmBoardStore.setState({ filters: {}, focus: {}, seen: {} });
});

describe("Swarm Board reading aids", () => {
	it("only acknowledges a long post after its body ends in view", async () => {
		const long = message("m1", {
			body: Array.from({ length: 80 }, (_, index) => `Paragraph ${index}`).join("\n\n"),
		});
		useSwarmBoardStore.setState({ seen: { ses_a: long.timestamp - 1 } });
		await showBoard({ boards: { ses_a: board([long]) } });
		await expect.element(pane().getByTestId("swarm-board-messages"), WAIT).toBeVisible();
		const list = pane().getByTestId("swarm-board-messages").element() as HTMLElement;
		await expect.poll(() => list.scrollHeight).toBeGreaterThan(list.clientHeight * 3);
		list.scrollTop = list.scrollHeight;
		await expect.poll(() => useSwarmBoardStore.getState().seen.ses_a).toBe(long.timestamp);
	});

	it("does not acknowledge filtered-out arrivals or posts in another view", async () => {
		const host = await showBoard({ boardEvents: true });
		await expect.poll(() => posts().all().length, WAIT).toBe(5);
		filterTo("ses_c2");
		const before = useSwarmBoardStore.getState().seen.ses_a;
		host.core.setBoard("ses_a", {
			...board([...POSTS, message("m6", { type: "VETO", body: "Signing failed" })]),
			revision: 2,
		});
		host.core.announceBoard("ses_a");
		await expect.element(pane().getByTestId("swarm-board-new-messages"), WAIT).toBeVisible();
		expect(useSwarmBoardStore.getState().seen.ses_a).toBe(before);
		await pane().getByTestId("swarm-team-toggle").click();
		host.core.setBoard("ses_a", {
			...board([...POSTS, message("m6"), message("m7")]),
			revision: 3,
		});
		host.core.announceBoard("ses_a");
		await expect.poll(() => host.core.calls.boardReads.mock.calls.length).toBeGreaterThanOrEqual(3);
		expect(useSwarmBoardStore.getState().seen.ses_a).toBe(before);
	});

	it("preserves the reading anchor when older messages load and new posts arrive", async () => {
		const history = Array.from({ length: 60 }, (_, index) =>
			message(`m${index + 1}`, { body: `Checkpoint ${index + 1}` }),
		);
		const host = await showBoard({ boards: { ses_a: board(history) }, boardEvents: true });
		const list = pane().getByTestId("swarm-board-messages");
		await expect.poll(() => posts().all().length, WAIT).toBe(50);
		const element = list.element() as HTMLElement;
		element.scrollTop = 0;
		element.dispatchEvent(new Event("scroll"));
		const anchor = posts().first().element();
		const before = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
		await pane().getByTestId("swarm-board-older").click();
		await expect.poll(() => posts().all().length, WAIT).toBe(60);
		await expect
			.poll(() =>
				Math.abs(anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - before),
			)
			.toBeLessThan(2);
		const readingAt = element.scrollTop;
		host.core.setBoard("ses_a", { ...board([...history, message("m61")]), revision: 2 });
		host.core.announceBoard("ses_a");
		await expect.poll(() => posts().all().length, WAIT).toBe(61);
		await expect.poll(() => element.scrollTop).toBe(readingAt);
		await expect.element(pane().getByTestId("swarm-board-new-messages")).toBeVisible();
	});

	it("preserves the visible post when a new reply is inserted above it", async () => {
		const history = Array.from({ length: 30 }, (_, index) =>
			message(`m${index + 1}`, { body: `Checkpoint ${index + 1}` }),
		);
		const host = await showBoard({ boards: { ses_a: board(history) }, boardEvents: true });
		await expect.poll(() => posts().all().length, WAIT).toBe(30);
		const list = pane().getByTestId("swarm-board-messages").element() as HTMLElement;
		list.scrollTop = (list.scrollHeight - list.clientHeight) / 2;
		list.dispatchEvent(new Event("scroll"));
		const anchor = posts()
			.all()
			.map((post) => post.element())
			.find((post) => post.getBoundingClientRect().top >= list.getBoundingClientRect().top)!;
		const before = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
		host.core.setBoard("ses_a", {
			...board([
				...history,
				message("m31", { replyTo: "m1", body: "A new reply to an older post" }),
			]),
			revision: 2,
		});
		host.core.announceBoard("ses_a");
		await expect.poll(() => posts().all().length, WAIT).toBe(31);
		await expect
			.poll(() =>
				Math.abs(anchor.getBoundingClientRect().top - list.getBoundingClientRect().top - before),
			)
			.toBeLessThan(2);
	});

	it("removes pending-arrival navigation when the board is cleared", async () => {
		const host = await showBoard({ boardEvents: true });
		await expect.poll(() => posts().all().length, WAIT).toBe(5);
		filterTo("ses_c2");
		host.core.setBoard("ses_a", { ...board([...POSTS, message("m6")]), revision: 2 });
		host.core.announceBoard("ses_a");
		await expect.element(pane().getByTestId("swarm-board-new-messages"), WAIT).toBeVisible();
		host.core.setBoard("ses_a", { ...board([]), revision: 3 });
		host.core.announceBoard("ses_a");
		await expect.element(pane().getByTestId("swarm-board-empty"), WAIT).toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-new-messages")).not.toBeInTheDocument();
	});

	it("marks where the posts the person hasn't seen start", async () => {
		useSwarmBoardStore.setState({ seen: { ses_a: START + 3 * MINUTE } });
		await showBoard();

		const divider = pane().getByTestId("swarm-board-new-divider");
		await expect.poll(textOf(divider), WAIT).toContain("2 new since you looked");
		await expect.element(posts().nth(3)).toHaveAttribute("data-new", "true");
	});

	it("copies the board, or what the filters show, as markdown", async () => {
		const chat = await showBoard();
		await expect.poll(() => posts().all().length, WAIT).toBe(5);
		filterTo("ses_c1");
		await pane().getByTestId("swarm-board-actions").click();
		await page.getByTestId("swarm-board-copy").click();

		await expect.poll(() => chat.copied.at(-1)).toContain("**Bridge RPC → Main agent** · #1");
		expect(chat.copied.at(-1)).toContain("Are you blocked?");
		expect(chat.copied.at(-1)).not.toContain("UI shows the count");
	});
});

describe("the composer's Board button", () => {
	it("counts the board posts the person hasn't seen", async () => {
		useSwarmBoardStore.setState({ seen: { ses_a: START + 3 * MINUTE } });
		await renderChat({
			server: delegatingServer(),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: TEAM,
			boards: { ses_a: board(POSTS) },
		});

		await expect
			.poll(textOf(page.getByTestId("kilo-composer-swarm-board-unread")), WAIT)
			.toContain("2");
	});
});
