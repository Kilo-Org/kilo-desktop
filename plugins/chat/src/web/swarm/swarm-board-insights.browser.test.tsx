import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";
import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import { chatPaneObject, SWARM_PANE_KIND, swarmPaneId } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { toolPart } from "../../test/transcript";
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
	revision: 1,
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
/** Opens a filter menu (its items render in a popup outside the pane). */
const openMenu = (menu: "type" | "agent") =>
	pane().getByTestId(`swarm-board-filter-${menu}-menu`).click({ timeout: WAIT.timeout });
const closeMenu = () => userEvent.keyboard("{Escape}");

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
	useSwarmBoardStore.setState({ filters: {}, seen: {} });
});

describe("Swarm Board filters", () => {
	it("filters by type, with each type's count", async () => {
		await showBoard();
		await openMenu("type");
		const ask = page.getByTestId("swarm-board-filter-type-ASK");
		await expect.poll(textOf(ask), WAIT).toContain("2");

		await ask.click();
		await page.getByTestId("swarm-board-filter-type-RESULT").click();

		await expect.element(ask).toHaveAttribute("aria-checked", "true");
		await expect.poll(() => posts().all().length).toBe(4);
		await closeMenu();
		await expect
			.poll(textOf(pane().getByTestId("swarm-board-filter-type-menu")), WAIT)
			.toContain("2 selected");
		await openMenu("type");
		await page.getByTestId("swarm-board-filter-type-RESULT").click();
		await closeMenu();
		await expect.poll(() => posts().all().length).toBe(2);
		await expect
			.poll(textOf(pane().getByTestId("swarm-board-filter-count")), WAIT)
			.toContain("2 of 5");
		await pane().getByTestId("swarm-board-filter-clear").click();
		await expect.poll(() => posts().all().length).toBe(5);
	});

	it("filters by agent, from, to or both", async () => {
		await showBoard();
		await openMenu("agent");
		await page.getByTestId("swarm-board-filter-agent").filter({ hasText: "Desktop UI" }).click();

		await expect.poll(() => posts().all().length).toBe(3);
		await page.getByTestId("swarm-board-filter-direction-from").click();
		await expect.poll(() => posts().all().length).toBe(2);
		await page.getByTestId("swarm-board-filter-direction-to").click();
		await expect.poll(() => posts().all().length).toBe(1);
		await closeMenu();
		await expect
			.poll(textOf(pane().getByTestId("swarm-board-filter-agent-menu")), WAIT)
			.toContain("Desktop UI");
	});

	it("searches post bodies and marks the matches", async () => {
		await showBoard();
		await pane().getByTestId("swarm-board-search").fill("schema", { timeout: WAIT.timeout });

		await expect.poll(() => posts().all().length).toBe(1);
		await expect
			.poll(() => posts().first().element().querySelector("mark")?.textContent, WAIT)
			.toBe("schema");
	});

	it("shows only posts waiting for an answer, counted and ringed", async () => {
		await showBoard();
		// m2 is answered by m4; m3 is still waiting.
		await expect
			.poll(() => pane().getByTestId("swarm-board-message-open").all().length, WAIT)
			.toBe(1);
		await openMenu("type");
		const open = page.getByTestId("swarm-board-filter-open");
		await expect.poll(textOf(open), WAIT).toContain("1");

		await open.click();
		await closeMenu();
		await expect.poll(() => posts().all().length).toBe(1);
		await expect.element(posts().first().getByText("Are you blocked?")).toBeVisible();
	});

	it("says when nothing matches", async () => {
		await showBoard();
		await pane()
			.getByTestId("swarm-board-search")
			.fill("nothing like this", { timeout: WAIT.timeout });
		await expect.element(pane().getByTestId("swarm-board-no-match")).toBeVisible();
	});
});

describe("Swarm Board reading aids", () => {
	it("shows the originating user objective without opening the chat transcript", async () => {
		await showBoard();
		await expect
			.element(pane().getByTestId("swarm-board-objective"), WAIT)
			.toHaveTextContent("Map it");
	});

	it("only acknowledges a long post after its body ends in view", async () => {
		const long = message("m1", {
			body: Array.from({ length: 40 }, (_, index) => `Paragraph ${index}`).join("\n\n"),
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
		await pane().getByTestId("swarm-board-search").fill("schema");
		const before = useSwarmBoardStore.getState().seen.ses_a;
		host.core.setBoard("ses_a", {
			...board([...POSTS, message("m6", { type: "VETO", body: "Signing failed" })]),
			revision: 2,
		});
		host.core.announceBoard("ses_a");
		await expect.element(pane().getByTestId("swarm-board-new-messages"), WAIT).toBeVisible();
		expect(useSwarmBoardStore.getState().seen.ses_a).toBe(before);
		await pane()
			.getByRole("tab", { name: /Results/ })
			.click();
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
		list.scrollTop = 1500;
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
		await pane().getByTestId("swarm-board-search").fill("schema");
		host.core.setBoard("ses_a", { ...board([...POSTS, message("m6")]), revision: 2 });
		host.core.announceBoard("ses_a");
		await expect.element(pane().getByTestId("swarm-board-new-messages"), WAIT).toBeVisible();
		host.core.setBoard("ses_a", { ...board([]), revision: 3 });
		host.core.announceBoard("ses_a");
		await expect.element(pane().getByTestId("swarm-board-empty"), WAIT).toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-new-messages")).not.toBeInTheDocument();
	});

	it("identifies the task and separates activity, results and timeline views", async () => {
		await showBoard();
		await expect.element(pane().getByRole("heading", { name: "Map conda" }), WAIT).toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-results")).not.toBeInTheDocument();
		await pane()
			.getByRole("tab", { name: /Results/ })
			.click();
		await expect.element(pane().getByTestId("swarm-board-results")).toBeVisible();
		await expect.element(pane().getByTestId("swarm-board-messages")).not.toBeVisible();
		await pane().getByRole("tab", { name: "Timeline" }).click();
		await expect.element(pane().getByTestId("swarm-timeline")).toBeVisible();
		await pane().getByRole("tab", { name: "Activity" }).click();
		await expect.element(pane().getByTestId("swarm-board-messages")).toBeVisible();
	});

	it("threads replies under the post they answer, folding to a count", async () => {
		await showBoard();
		const thread = pane().getByTestId("swarm-board-thread");
		await expect.element(thread.getByText("It returns { count }"), WAIT).toBeVisible();

		await thread.getByTestId("swarm-board-thread-toggle").click();
		await expect
			.poll(textOf(thread.getByTestId("swarm-board-thread-toggle")), WAIT)
			.toContain("1 reply");
		await expect.element(thread.getByText("It returns { count }")).not.toBeInTheDocument();
	});

	it("digests each agent's latest result and jumps to it", async () => {
		await showBoard();
		await pane()
			.getByRole("tab", { name: /Results/ })
			.click();
		const results = pane().getByTestId("swarm-board-result");
		await expect.poll(() => results.all().length, WAIT).toBe(2);
		await expect.poll(textOf(results.nth(0)), WAIT).toContain("Bridge exposes count_envs");

		await results.nth(1).getByTestId("swarm-board-result-source").click();
		await expect.element(posts().getByText("UI shows the count", { exact: true })).toBeInViewport();
	});

	it("marks where the posts the person hasn't seen start, and counts them on the Board button", async () => {
		useSwarmBoardStore.setState({ seen: { ses_a: START + 3 * MINUTE } });
		await showBoard();

		const divider = pane().getByTestId("swarm-board-new-divider");
		await expect.element(divider, WAIT).toBeVisible();
		// m4 is new but threaded under m2; the thread says so.
		await expect
			.poll(textOf(pane().getByTestId("swarm-board-thread-new")), WAIT)
			.toContain("1 new");
	});

	it("copies the board, or what the filters show, as markdown", async () => {
		const chat = await showBoard();
		await openMenu("type");
		await page.getByTestId("swarm-board-filter-type-RESULT").click();
		await closeMenu();
		await pane().getByTestId("swarm-board-actions").click();
		await page.getByTestId("swarm-board-copy").click();

		await expect.poll(() => chat.copied.at(-1)).toContain("Bridge RPC → Main agent");
		expect(chat.copied.at(-1)).toContain("UI shows the count");
		expect(chat.copied.at(-1)).not.toContain("Are you blocked?");
	});

	it("shows when each agent ran, with an uncertain end when nothing says when it stopped", async () => {
		await showBoard({
			jobs: {
				ses_a: [
					{
						id: "job_1",
						type: "task",
						status: "completed",
						chatId: "ses_c1",
						startedAt: START + MINUTE,
						completedAt: START + 4 * MINUTE,
					},
				],
			},
		});
		await pane().getByTestId("swarm-timeline-toggle").click({ timeout: WAIT.timeout });

		const bars = pane().getByTestId("swarm-timeline-bar");
		await expect.poll(() => bars.all().length).toBe(3);
		await expect.element(bars.nth(1)).toHaveAttribute("data-ending", "known");
		await expect.element(bars.nth(2)).toHaveAttribute("data-ending", "unknown");
		await expect.poll(() => pane().getByTestId("swarm-timeline-post").all().length).toBe(5);

		const key = pane().getByTestId("swarm-timeline-key");
		await expect.element(key.getByText("Hold / veto")).toBeVisible();
		await expect
			.element(key.getByTestId("swarm-timeline-about"))
			.toHaveAccessibleName(/5 posts plotted from loaded history/);
		await pane().getByTestId("swarm-timeline-key-button").click();
		await expect
			.element(
				page
					.getByTestId("swarm-timeline-key-popover")
					.getByText("A HOLD or VETO: it blocks someone"),
			)
			.toBeVisible();
	});

	it("shows an agent's details through an explicit keyboard-accessible control", async () => {
		await showBoard();
		await pane().getByTestId("swarm-team-toggle").click();
		await pane()
			.getByTestId("swarm-team-row")
			.nth(1)
			.getByTestId("swarm-team-member-details-toggle")
			.click({ timeout: WAIT.timeout });

		const card = page.getByTestId("swarm-team-member-details");
		await expect.element(card, WAIT).toBeVisible();
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

describe("Swarm Board timeline and connections", () => {
	const openActivity = () =>
		pane().getByTestId("swarm-timeline-toggle").click({ timeout: WAIT.timeout });

	it("draws each post as an arrow from its sender to its recipient, and jumps to it", async () => {
		await showBoard();
		await openActivity();

		const arrows = pane().getByTestId("swarm-timeline-post");
		await expect.poll(() => arrows.all().length, WAIT).toBe(5);
		// m1: Bridge RPC (lane 1) to the main agent (lane 0); m3: main to Bridge RPC.
		await expect.element(arrows.nth(0)).toHaveAttribute("data-to", "0");
		await expect.element(arrows.nth(2)).toHaveAttribute("data-to", "1");
		await expect
			.element(arrows.nth(2))
			.toHaveAttribute("aria-label", expect.stringContaining("Main agent to Bridge RPC, ASK"));

		await arrows.nth(4).click();
		await pane().getByTestId("swarm-timeline-source").click();
		await expect.element(posts().getByText("UI shows the count", { exact: true })).toBeInViewport();
	});

	it("links a post's replies and dims the rest while it is hovered", async () => {
		await showBoard();
		await openActivity();
		const arrows = pane().getByTestId("swarm-timeline-post");
		await expect.poll(() => arrows.all().length, WAIT).toBe(5);

		// m4 answers m2.
		await arrows.nth(3).hover();
		await expect.poll(() => pane().getByTestId("swarm-timeline-reply").all().length).toBe(1);
		await expect
			.poll(() => arrows.nth(0).element().getAttribute("class") ?? "")
			.toContain("opacity-25");
	});

	it("shows all loaded coordination independently of the Activity filters", async () => {
		await showBoard();
		await pane().getByTestId("swarm-board-search").fill("schema");
		await openActivity();
		await expect.poll(() => pane().getByTestId("swarm-timeline-post").all().length, WAIT).toBe(5);
	});

	it("splits work separated by a long pause into runs, the latest open", async () => {
		await showBoard({
			chats: [
				...TEAM,
				chatSummary("ses_c3", {
					parentId: "ses_a",
					title: "Architect (@general subagent)",
					createdAt: START + 30 * MINUTE,
				}),
			],
			boards: {
				ses_a: board([
					...POSTS,
					message("m40", { from: "ses_c3", type: "RESULT", body: "Review summary" }),
				]),
			},
		});
		await openActivity();

		const runs = pane().getByTestId("swarm-run");
		await expect.poll(() => runs.all().length, WAIT).toBe(2);
		await expect.poll(textOf(runs.nth(0)), WAIT).toContain("Activity period 1");
		await expect.poll(textOf(runs.nth(1)), WAIT).toContain("1 agent");
		// Only the latest run's chart is open: the main agent and the Architect.
		await expect.poll(() => pane().getByTestId("swarm-timeline-bar").all().length).toBe(2);
		await expect.poll(textOf(pane().getByTestId("swarm-timeline")), WAIT).toContain("Architect");
		expect(textOf(pane().getByTestId("swarm-timeline"))()).not.toContain("(@general subagent)");

		await runs.nth(0).getByTestId("swarm-run-toggle").click();
		await expect.poll(() => pane().getByTestId("swarm-timeline").all().length).toBe(2);
	});
});
