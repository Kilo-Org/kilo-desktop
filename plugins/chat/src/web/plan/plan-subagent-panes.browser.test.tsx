import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	chatPaneObject,
	PLAN_PANE_KIND,
	SUBAGENT_PANE_KIND,
	subagentPaneId,
} from "../../contracts";
import { agentPane, chatSummary, workSession } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type FakeMessage,
} from "../../test/fake-kilo-server";
import { expandAll, expandUntil, toolPart, turnWork } from "../../test/transcript";
import { renderChat } from "../../test/render-chat";
import { DEFAULT_SWARM_PREFERENCES, useSwarmPreferences } from "../swarm/swarm-preferences";
import { resetPlanApprovalUiState } from "./use-approve-plan";

beforeEach(() => {
	resetPlanApprovalUiState();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const WAIT = { timeout: 15_000 };
const PLAN_PATH = ".kilo/plans/ship.md";
const PLAN = "# Ship the login fix\n\n## Steps\n\n- Patch the session check\n- Add a test";

const planFollowup = (id = "que_plan") => ({
	id,
	questions: [
		{
			question: "Ready to implement?",
			header: "Implement",
			options: [{ label: "Continue here" }, { label: "Keep refining" }],
			custom: true,
		},
	],
});

function planTurn(parts = [writePlan(), planExit()]): FakeMessage[] {
	return [
		userMessage("ses_a", "msg_1", "Plan the login fix"),
		{
			...assistantMessage("ses_a", "msg_2", "msg_1", parts),
			info: { ...assistantMessage("ses_a", "msg_2", "msg_1", []).info, agent: "plan" },
		},
	];
}

const writePlan = (content = PLAN) =>
	toolPart("write", { input: { filePath: PLAN_PATH, content } }, "call_write");
const planExit = (input: Record<string, unknown> = {}) =>
	toolPart("plan_exit", { input }, "call_exit");

const task = (callID: string, childId: string, description: string, status = "completed") =>
	toolPart(
		"task",
		{
			status,
			input: { description, subagent_type: "explore" },
			output: status === "completed" ? "<task_result>Done</task_result>" : undefined,
			metadata: { sessionId: childId },
		},
		callID,
	);

function server(messages: FakeMessage[], children: Record<string, FakeMessage[]> = {}) {
	const fake = new FakeKiloServer();
	fake.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", messages });
	for (const [id, childMessages] of Object.entries(children)) {
		fake.addChat({ id, directory: "/projects/app", title: id, messages: childMessages });
	}
	return fake;
}

async function show(
	fake: FakeKiloServer,
	options: Omit<Parameters<typeof renderChat>[0] & object, "server"> = {},
) {
	const host = await renderChat({
		server: fake,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
		...options,
	});
	await vi.waitFor(() => expect(fake.openStreams).toBe(1), WAIT);
	return host;
}

const childReply = (childId: string, text: string): FakeMessage[] => [
	userMessage(childId, `${childId}_u`, "Look into it"),
	assistantMessage(childId, `${childId}_a`, `${childId}_u`, [{ type: "text", text }]),
];

const card = () => page.getByTestId("kilo-plan-card");
const planPane = () => page.getByTestId("kilo-plan-pane");
const subagentPane = () => page.getByTestId("kilo-subagent-pane");

describe("the plan card", () => {
	it("stands in for the plan's calls and opens the plan pane on its revision", async () => {
		const host = await show(server(planTurn()));

		await expect.element(card()).toBeVisible();
		await expect.element(card().getByText("Ship the login fix")).toBeVisible();
		await page.getByTestId("kilo-plan-view").click();

		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: PLAN_PANE_KIND,
				object: chatPaneObject("ses_a"),
				metadata: {
					planAnchorCallId: "call_write",
					planNewestAnchorCallIdAtOpen: "call_write",
				},
			}),
		);
		await expect.element(planPane().getByText("Ship the login fix"), WAIT).toBeVisible();
		await expect.element(planPane().getByText("Patch the session check")).toBeVisible();
	});

	it("approves the plan by answering Kilo's follow-up question", async () => {
		const fake = server(planTurn());
		await show(fake);
		await expect.element(card()).toBeVisible();

		fake.askQuestion("ses_a", planFollowup());
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();
		await card().getByTestId("kilo-plan-approve").click();

		await expect
			.poll(() => fake.requestsTo("POST", "/question/que_plan/reply")[0]?.body, WAIT)
			.toEqual({ answers: [["Continue here"]] });
		await expect.element(card().getByTestId("kilo-plan-approved")).toBeVisible();
	});

	it("stops the turn's work timer once the plan is handed over, though Kilo stays busy", async () => {
		const [prompt, reply] = planTurn([writePlan()]);
		// The step that wrote the plan still has the plan_exit call to make.
		const fake = server([prompt!, { ...reply!, info: { ...reply!.info, finish: "tool-calls" } }]);
		await show(fake);
		// Kilo's turn waits on the follow-up, so the chat is busy while it is asked.
		fake.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-turn-working"), WAIT).toBeVisible();

		fake.emit("message.part.updated", {
			part: { ...planExit(), id: "part_exit", sessionID: "ses_a", messageID: "msg_2" },
		});
		fake.askQuestion("ses_a", planFollowup("que_timer"));
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();
		await expect.element(page.getByTestId("kilo-turn-working")).not.toBeInTheDocument();
	});

	// Kilo stores a typed follow-up answer as a hidden synthetic message, so refining
	// dismisses the follow-up and sends the text as an ordinary, visible prompt.
	it("refines the plan by sending what the person types as a visible message", async () => {
		const fake = server(planTurn());
		await show(fake);
		fake.askQuestion("ses_a", planFollowup("que_refine"));
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-question-card"]')).toBeNull();

		await userEvent.fill(page.getByTestId("kilo-composer-input"), "Keep it to one file");
		await page.getByTestId("kilo-composer-refine").click();

		await expect
			.poll(() => fake.requestsTo("POST", "/question/que_refine/reject").length, WAIT)
			.toBe(1);
		await expect
			.poll(() => JSON.stringify(fake.requestsTo("POST", "/session/ses_a/prompt_async")), WAIT)
			.toContain("Keep it to one file");
		expect(fake.requestsTo("POST", "/question/que_refine/reply")).toHaveLength(0);
		await expect.element(page.getByText("Keep it to one file"), WAIT).toBeVisible();
	});

	it("refines on Enter while Kilo waits on the follow-up", async () => {
		const fake = server(planTurn());
		await show(fake);
		// Kilo's turn waits on the question, so the chat is busy while it is asked.
		fake.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		fake.askQuestion("ses_a", planFollowup("que_enter"));
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();

		await userEvent.fill(page.getByTestId("kilo-composer-input"), "Smaller steps");
		await userEvent.keyboard("{Enter}");

		await expect
			.poll(() => fake.requestsTo("POST", "/question/que_enter/reject").length, WAIT)
			.toBe(1);
		// The finished plan turn stays folded while Kilo winds down.
		await expect.element(page.getByTestId("kilo-composer-refine")).not.toBeInTheDocument();
		expect(document.querySelector('[data-qa-id="kilo-turn-working"]')).toBeNull();
		// Rejecting ends Kilo's turn; the queued refinement goes out once the chat is idle.
		fake.emit("session.status", { sessionID: "ses_a", status: { type: "idle" } });
		await expect
			.poll(() => JSON.stringify(fake.requestsTo("POST", "/session/ses_a/prompt_async")), WAIT)
			.toContain("Smaller steps");
	});

	it("shows a plan handed over by plan_exit alone, read from its file", async () => {
		const fake = server(planTurn([planExit({ path: PLAN_PATH })]));
		fake.files[PLAN_PATH] = "# From disk\n\nRead the plan file";
		await show(fake);

		await expect.element(card().getByText("From disk"), WAIT).toBeVisible();
		await expect.element(card().getByText("Read the plan file")).toBeVisible();
	});

	it("says the plan is being written, and why the hand-over failed", async () => {
		const fake = server(
			planTurn([
				toolPart("write", { status: "running", input: { filePath: PLAN_PATH } }, "call_write"),
			]),
		);
		const host = await show(fake);
		await expect.element(page.getByTestId("kilo-plan-writing"), WAIT).toBeVisible();
		host.view.unmount();

		await show(
			server(
				planTurn([
					writePlan(),
					toolPart("plan_exit", { status: "error", error: "The plan was rejected" }, "call_exit"),
				]),
			),
		);
		await expect.element(page.getByText("The plan was rejected"), WAIT).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-plan-approve"]')).toBeNull();
	});

	it("leaves edits to files that aren't plans as diffs", async () => {
		await show(
			server(
				planTurn([
					writePlan(),
					toolPart("write", { input: { filePath: "src/app.ts", content: "x" } }, "call_code"),
				]),
			),
		);

		await expect.element(card()).toBeVisible();
		await expandUntil([turnWork], () =>
			expect(page.getByText("app.ts").first().element()).toBeInTheDocument(),
		);
		expect(document.querySelectorAll('[data-qa-id="kilo-plan-card"]')).toHaveLength(1);
	});
});

describe("the plan pane", () => {
	const planPaneRecord = (patch: Partial<Pane> = {}): Pane => ({
		id: "plan",
		kind: PLAN_PANE_KIND,
		title: "Plan",
		metadata: {},
		ordinal: 1,
		...patch,
	});
	const planPaneOf = (chatId: string) => planPaneRecord({ object: chatPaneObject(chatId) });

	it("shows the plan pane for its chat and approves from there", async () => {
		const fake = server(planTurn());
		await show(fake, {
			workSession: workSession({ chatIds: ["ses_a"] }),
			otherPanes: [planPaneOf("ses_a")],
		});

		await expect.element(planPane().getByText("Patch the session check"), WAIT).toBeVisible();
		fake.askQuestion("ses_a", planFollowup("que_pane"));
		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);

		await expect
			.poll(() => fake.requestsTo("POST", "/question/que_pane/reply")[0]?.body, WAIT)
			.toEqual({ answers: [["Continue here"]] });
	});

	it("brings the agent pane's agent along when the plan is approved there", async () => {
		const fake = server(planTurn());
		await show(fake, { otherPanes: [planPaneOf("ses_a")] });
		const agent = page.getByTestId("kilo-agent-selector-trigger");
		await expect.element(agent, WAIT).toHaveTextContent("Code");
		await userEvent.click(page.getByTestId("kilo-composer-input"));
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		await expect.element(agent).toHaveTextContent("Plan");

		fake.askQuestion("ses_a", planFollowup("que_follow"));
		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);
		await expect
			.poll(() => fake.requestsTo("POST", "/question/que_follow/reply").length, WAIT)
			.toBe(1);
		fake.emit("question.replied", {
			sessionID: "ses_a",
			requestID: "que_follow",
			answers: [["Continue here"]],
		});
		fake.emit("session.updated", {
			info: {
				id: "ses_a",
				slug: "ses_a",
				projectID: "project",
				directory: "/projects/app",
				title: "Chat",
				version: "7.8.17",
				time: { created: 1, updated: 2 },
				agent: "code",
			},
		});

		await expect.element(agent, WAIT).toHaveTextContent("Code");
	});

	it("asks for the plan to be implemented when Kilo asked nothing", async () => {
		const fake = server(planTurn());
		await show(fake, { otherPanes: [planPaneOf("ses_a")] });

		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);

		await vi.waitFor(
			() => expect(fake.requestsTo("POST", "/session/ses_a/prompt_async")).toHaveLength(1),
			WAIT,
		);
		const body = fake.requestsTo("POST", "/session/ses_a/prompt_async")[0]!.body as {
			agent?: string;
			parts: { type: string; text?: string }[];
		};
		expect(body.agent).toBe("code");
		expect(body.parts.some((part) => part.text === "Implement the plan above.")).toBe(true);
		await expect.element(planPane().getByTestId("chat-pane-plan-approved")).toBeVisible();
	});

	it("says when the chat has no plan yet", async () => {
		await show(server([userMessage("ses_a", "msg_1", "Hello")]), {
			otherPanes: [planPaneOf("ses_a")],
		});

		await expect.element(page.getByTestId("chat-pane-plan-empty"), WAIT).toBeVisible();
	});
});

describe("subagent panes", () => {
	const subagentPaneRecord = (
		childChatId: string,
		metadata: Record<string, string> = {},
	): Pane => ({
		id: subagentPaneId(childChatId),
		kind: SUBAGENT_PANE_KIND,
		title: "Audit login",
		object: chatPaneObject(childChatId),
		metadata,
		ordinal: 1,
	});

	it("opens one pane per delegation from its row", async () => {
		const fake = server(
			planTurn([
				task("call_t1", "ses_c1", "Audit login"),
				task("call_t2", "ses_c2", "Audit logout"),
			]),
			{ ses_c1: childReply("ses_c1", "Login is fine"), ses_c2: childReply("ses_c2", "Logout") },
		);
		const host = await show(fake);
		const row = (title: string) => () =>
			document.querySelector(`[aria-label="Open subagent: ${title}"]`);
		await expect.element(page.getByText("Plan the login fix").first()).toBeInTheDocument();
		await expandAll();
		await vi.waitFor(() => expect(row("Audit logout")()).not.toBeNull(), WAIT);

		(row("Audit login")() as HTMLElement).click();
		await expect.element(subagentPane().getByText("Login is fine"), WAIT).toBeVisible();
		(row("Audit login")() as HTMLElement).click();
		(row("Audit logout")() as HTMLElement).click();

		await vi.waitFor(() => {
			const ids = host.panes().panes.map((pane) => pane.id);
			expect(ids.filter((id) => id.startsWith("subagent:"))).toEqual([
				"subagent:ses_c1",
				"subagent:ses_c2",
			]);
		}, WAIT);
		expect(host.panes().panes.find((pane) => pane.id === "subagent:ses_c1")).toMatchObject({
			title: "Audit login",
			object: chatPaneObject("ses_c1"),
			metadata: { chatId: "ses_a" },
		});
	});

	it("shows the child's transcript and the prompt it waits on", async () => {
		const fake = server(planTurn([task("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: childReply("ses_c1", "Reading login.ts"),
		});
		await show(fake, {
			otherPanes: [subagentPaneRecord("ses_c1", { chatId: "ses_a" })],
		});
		await expect.element(subagentPane().getByText("Reading login.ts"), WAIT).toBeVisible();

		fake.askPermission("ses_c1", { id: "per_child", permission: "bash", patterns: ["ls"] });

		await expect.element(page.getByTestId("subagent-pane-prompt"), WAIT).toBeVisible();
		await page.getByTestId("subagent-pane-prompt").getByTestId("kilo-permission-once").click();
		await expect
			.poll(() => fake.requestsTo("POST", "/permission/per_child/reply")[0]?.body, WAIT)
			.toMatchObject({ reply: "once" });
	});

	it("offers no fork on the child's messages", async () => {
		const fake = server(planTurn([task("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: [
				...childReply("ses_c1", "Reading login.ts"),
				userMessage("ses_c1", "ses_c1_u2", "Look again"),
				assistantMessage("ses_c1", "ses_c1_a2", "ses_c1_u2", [
					{ type: "text", text: "Still fine" },
				]),
			],
		});
		await show(fake, {
			otherPanes: [subagentPaneRecord("ses_c1", { chatId: "ses_a" })],
		});

		await expect.element(subagentPane().getByText("Still fine"), WAIT).toBeVisible();
		expect(subagentPane().getByTestId("kilo-fork-from-here-button").elements()).toHaveLength(0);
	});

	it("finds the delegating chat of origin's pane through kilo.core", async () => {
		const fake = server(planTurn([task("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: childReply("ses_c1", "Origin's child"),
		});
		const { object: _object, ...origins } = subagentPaneRecord("ses_c1", {
			childSessionId: "ses_c1",
		});
		await show(fake, {
			chats: [chatSummary("ses_a"), chatSummary("ses_c1", { parentId: "ses_a" })],
			otherPanes: [origins],
		});

		await expect.element(subagentPane().getByText("Origin's child"), WAIT).toBeVisible();
	});

	it("says when the child can't be found", async () => {
		await show(server([userMessage("ses_a", "msg_1", "Hello")]), {
			otherPanes: [subagentPaneRecord("ses_gone", { chatId: "ses_a" })],
		});

		await expect.element(page.getByTestId("subagent-pane-unavailable"), WAIT).toBeVisible();
	});
});

describe("running subagents", () => {
	// The one-line strip these tests drive is what shows with the swarm shelf turned off.
	beforeEach(() => useSwarmPreferences.setState({ shelf: false }));
	afterEach(() => useSwarmPreferences.setState(DEFAULT_SWARM_PREFERENCES));

	async function working() {
		const fake = server(planTurn([task("call_t1", "ses_c1", "Audit login", "running")]), {
			ses_c1: childReply("ses_c1", "Working"),
		});
		const host = await show(fake);
		fake.emit("session.status", { sessionID: "ses_c1", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-subagents"), WAIT).toBeVisible();
		return { fake, host };
	}

	it("lists them over the composer and stops the chat's tree through kilo.core", async () => {
		const { host } = await working();
		await expect
			.element(page.getByTestId("kilo-composer-subagents").getByText("1 Running"))
			.toBeVisible();
		await page.getByTestId("kilo-composer-subagents-jump").click();

		await page.getByTestId("kilo-composer-stop").click();

		await vi.waitFor(() => expect(host.agent.calls.abort).toHaveBeenCalledWith({ id: "ses_a" }));
	});

	it("stops one subagent from its row on the server when kilo.core doesn't know it", async () => {
		const { fake } = await working();
		const stop = () => document.querySelector('[aria-label="Stop subagent: Audit login"]');
		await expandUntil([turnWork], () => expect(stop()).not.toBeNull());

		(stop() as HTMLElement).click();

		await vi.waitFor(
			() => expect(fake.requestsTo("POST", "/session/ses_c1/abort")).toHaveLength(1),
			WAIT,
		);
	});
});
