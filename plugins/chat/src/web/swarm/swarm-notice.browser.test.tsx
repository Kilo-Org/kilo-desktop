import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import type { BoardMessage, ChatSummary, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";
import {
	WorkSessionDecoration,
	type WorkSessionDecorationProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	SWARM_PANE_KIND,
	subagentPaneId,
	swarmPaneId,
} from "../../contracts";
import { agentPane, chatSummary, workSession } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { expandUntil, toolPart, turnWork } from "../../test/transcript";
import { useSwarmBoardStore } from "./swarm-board-store";
import { DEFAULT_SWARM_PREFERENCES, useSwarmPreferences } from "./swarm-preferences";

const WAIT = { timeout: 15_000 };

/** Each test its own root chat: the board opens by itself at most once per root chat. */
let root = "";
let rootCount = 0;
const worker = (n: number) => `${root}_w${n}`;

beforeEach(() => {
	rootCount += 1;
	root = `ses_root${rootCount}`;
	useSwarmBoardStore.setState({ seen: {}, focus: {} });
	useSwarmPreferences.setState({ ...DEFAULT_SWARM_PREFERENCES, autoOpen: "never" });
});
afterEach(() => useSwarmPreferences.setState(DEFAULT_SWARM_PREFERENCES));

const TITLES = ["Map bridge RPC", "Audit login", "Write docs"];

const task = (n: number, status: string) =>
	toolPart(
		"task",
		{
			status,
			input: { description: TITLES[n - 1], subagent_type: "explore" },
			output: status === "completed" ? "<task_result>Done</task_result>" : undefined,
			metadata: { sessionId: worker(n) },
		},
		`call_${n}`,
	);

/** A root chat that delegated to `statuses.length` workers, the first one still running. */
function delegatingServer(statuses: readonly string[]) {
	const fake = new FakeKiloServer();
	fake.addChat({
		id: root,
		directory: "/projects/app",
		title: "Map conda",
		messages: [
			userMessage(root, "msg_1", "Map the bridge"),
			assistantMessage(
				root,
				"msg_2",
				"msg_1",
				statuses.map((status, index) => task(index + 1, status)),
			),
		],
	});
	statuses.forEach((_, index) =>
		fake.addChat({
			id: worker(index + 1),
			directory: "/projects/app",
			title: TITLES[index]!,
			messages: [],
		}),
	);
	return fake;
}

const team = (workers: number): ChatSummary[] => [
	chatSummary(root, { title: "Map conda" }),
	...Array.from({ length: workers }, (_, index) =>
		chatSummary(worker(index + 1), {
			parentId: root,
			title: TITLES[index]!,
			createdAt: index + 2,
			activity: {
				status: "idle",
				completedAt: 100 + index,
				pendingPermissionIds: [],
				pendingQuestionIds: [],
			},
		}),
	),
];

const post = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: Date.UTC(2026, 10, 11, 10, Number(id.slice(1))),
	from: worker(1),
	to: "main",
	type: "RESULT",
	body: `Finding ${id}\nMore detail`,
	...patch,
});

const board = (messages: BoardMessage[]): SwarmBoard => ({
	ownerChatId: root,
	revision: messages.length,
	messages,
	hasMore: false,
});

async function showSwarm({
	statuses = ["running", "completed"],
	posts = [post("m1"), post("m2", { from: worker(2), body: "Login is safe" })],
}: { statuses?: readonly string[]; posts?: BoardMessage[] } = {}) {
	const working = statuses[0] === "running";
	const fake = delegatingServer(statuses);
	const host = await renderChat({
		server: fake,
		pane: agentPane({ object: chatPaneObject(root) }),
		chats: team(statuses.length),
		boards: { [root]: board(posts) },
		workSession: workSession({ chatIds: [root] }),
	});
	await vi.waitFor(() => expect(fake.openStreams).toBe(1), WAIT);
	fake.emit("session.status", {
		sessionID: worker(1),
		status: { type: working ? "busy" : "idle" },
	});
	return { fake, host };
}

const expectCard = () =>
	expect(document.querySelector('[data-qa-id="kilo-swarm-card"]')).not.toBeNull();
const shelf = () => page.getByTestId("kilo-composer-swarm-shelf");
const boardOpens = (host: Awaited<ReturnType<typeof renderChat>>) =>
	host.sessions.calls.open.mock.calls.filter(([input]) => input.kind === SWARM_PANE_KIND);

describe("the composer's swarm shelf", () => {
	it("shows the team's faces and the newest post, and opens an agent from its face", async () => {
		const { host } = await showSwarm();

		await expect.element(shelf(), WAIT).toBeVisible();
		await expect
			.element(shelf().getByTestId("kilo-composer-swarm-line"))
			.toHaveTextContent("Audit login→Main agentLogin is safe");
		const faces = shelf().getByTestId("kilo-composer-swarm-face");
		await expect.poll(() => faces.elements().length, WAIT).toBe(2);
		await expect.element(faces.nth(0)).toHaveAccessibleName("Open Map bridge RPC (working)");
		await expect.element(faces.nth(1)).toHaveAccessibleName("Open Audit login (finished)");
		await expect
			.element(shelf().getByTestId("kilo-composer-swarm-board-unread"))
			.toHaveTextContent("2");

		await faces.nth(1).click();

		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: SUBAGENT_PANE_KIND,
				paneId: subagentPaneId(worker(2)),
			}),
		);
	});

	it("counts the work before anyone posts", async () => {
		await showSwarm({ posts: [] });

		await expect
			.element(shelf().getByTestId("kilo-composer-swarm-line"), WAIT)
			.toHaveTextContent("1 working · 1 done");
	});

	it("puts a worker waiting on the person first, and Answer opens the board on it", async () => {
		const { host } = await showSwarm();
		await expect.element(shelf(), WAIT).toBeVisible();

		// kilo.core sees the question; the transcript (which would ask it in place of the composer) doesn't.
		const waiting = host.core.chats().state.chats[worker(1)]!;
		host.core.updateChat({
			...waiting,
			activity: { ...waiting.activity, pendingQuestionIds: ["que_1"] },
		});

		const answer = shelf().getByTestId("kilo-composer-swarm-answer");
		await expect.element(answer, WAIT).toBeVisible();
		await expect
			.element(shelf().getByTestId("kilo-composer-swarm-line"))
			.toHaveTextContent("Map bridge RPC→youhas a question");
		// The board takes the request as it opens here, so watch for it rather than read it after.
		const requested: unknown[] = [];
		const stop = useSwarmBoardStore.subscribe((state) => {
			if (state.focus[root]) requested.push(state.focus[root]);
		});
		await answer.click();
		stop();

		expect(requested[0]).toEqual({ kind: "question", chatId: worker(1) });
		expect(boardOpens(host)).toHaveLength(1);
		expect(boardOpens(host)[0]![0]).toMatchObject({ paneId: swarmPaneId(root) });
	});

	it("steps aside once everyone finished and the newest post was seen", async () => {
		const posts = [post("m1")];
		useSwarmBoardStore.setState({ seen: { [root]: posts[0]!.timestamp } });
		await showSwarm({ statuses: ["completed"], posts });
		// The transcript's card (in the finished turn's work) stays the way in once the shelf is gone.
		await expandUntil([turnWork], () => expectCard());

		expect(shelf().elements()).toHaveLength(0);
		expect(page.getByTestId("kilo-composer-subagents").elements()).toHaveLength(0);
	});

	it("shows the one-line strip instead when the person turned the shelf off", async () => {
		useSwarmPreferences.setState({ shelf: false });
		const { host } = await showSwarm();

		await expect.element(page.getByTestId("kilo-composer-subagents"), WAIT).toBeVisible();
		expect(shelf().elements()).toHaveLength(0);
		await page.getByTestId("kilo-composer-swarm-board").click();

		expect(boardOpens(host)).toHaveLength(1);
	});
});

describe("the transcript's swarm card", () => {
	it("counts the team and its posts, says it is live, and opens the board", async () => {
		const { host } = await showSwarm();
		const card = page.getByTestId("kilo-swarm-card");

		await expect.element(card, WAIT).toHaveAccessibleName("Open Swarm Board");
		await expect.element(card.getByText("Swarm Board · 2 agents")).toBeVisible();
		await expect
			.element(card.getByTestId("kilo-swarm-card-counts"), WAIT)
			.toHaveTextContent("1 working · 1 done · 2 posts");
		await expect.element(card.getByTestId("kilo-swarm-card-status")).toHaveTextContent("Live");

		await card.click();

		expect(boardOpens(host)).toHaveLength(1);
	});

	it("says it is done once nobody works", async () => {
		await showSwarm({ statuses: ["completed"], posts: [] });
		const card = page.getByTestId("kilo-swarm-card");

		await expandUntil([turnWork], () => expectCard());
		await expect
			.poll(() => card.getByTestId("kilo-swarm-card-status").element().textContent, WAIT)
			.toContain("Done");
	});
});

describe("the session list's swarm glyph", () => {
	async function showGlyph() {
		const { fake, host } = await showSwarm();
		const renderer = host.host.renderer;
		const contribution = renderer.extensions
			.list(WorkSessionDecoration)
			.find((candidate) => candidate.key === "kilo.chat/swarm");
		expect(contribution?.metadata.slot).toBe("status");
		render(
			<KernelProvider kernel={renderer}>
				<RenderContribution<WorkSessionDecorationProps>
					contribution={contribution!}
					props={{ workSession: workSession({ chatIds: [root] }) }}
				/>
			</KernelProvider>,
		);
		return { fake, glyph: page.getByTestId("kilo-swarm-session-decoration") };
	}

	it("dots green while a subagent works, in the text color while one waits, and not once all finished", async () => {
		const { fake, glyph } = await showGlyph();

		await expect.element(glyph, WAIT).toHaveAttribute("data-state", "working");
		await expect.element(glyph).toHaveAccessibleName("Swarm: 1 working");

		fake.askQuestion(worker(2), { id: "que_2", questions: [] });
		await expect.element(glyph, WAIT).toHaveAttribute("data-state", "needs-you");

		fake.emit("session.status", { sessionID: worker(1), status: { type: "idle" } });
		fake.questions.splice(0);
		fake.emit("question.replied", { sessionID: worker(2), requestID: "que_2" });
		await expect.element(glyph, WAIT).toHaveAttribute("data-state", "finished");
		await expect.element(glyph).toHaveAccessibleName("Swarm: 2 finished");
	});
});

describe("opening the board by itself", () => {
	it("opens it beside the chat once the delegations reach the threshold, and only once", async () => {
		useSwarmPreferences.setState({ autoOpen: "always" });
		const { fake, host } = await showSwarm();

		await vi.waitFor(() => expect(boardOpens(host)).toHaveLength(1), WAIT);
		expect(boardOpens(host)[0]![0]).toMatchObject({
			paneId: swarmPaneId(root),
			activate: false,
		});

		fake.emit("session.status", { sessionID: worker(1), status: { type: "idle" } });
		fake.emit("session.status", { sessionID: worker(1), status: { type: "busy" } });
		host.rerender();
		await expect.element(shelf(), WAIT).toBeVisible();
		expect(boardOpens(host)).toHaveLength(1);
	});

	it("stays shut below the threshold", async () => {
		useSwarmPreferences.setState({ autoOpen: "three" });
		const { host } = await showSwarm();

		await expect.element(shelf(), WAIT).toBeVisible();
		expect(boardOpens(host)).toHaveLength(0);
	});
});
