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
	nextCreated,
	textContent,
	toolContent,
	userMessage,
	type FakeMessage,
} from "../../test/fake-kilo-server";
import { expandAll, expandUntil, turnWork } from "../../test/transcript";
import { renderChat } from "../../test/render-chat";
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
		},
	],
});

type Content = Record<string, unknown>;

function planTurn(
	content: Content[] = [writePlan(), planExit()],
	options: { finish?: string } = {},
): FakeMessage[] {
	return [
		userMessage("msg_1", "Plan the login fix"),
		assistantMessage("msg_2", content, { agent: "plan", ...options }),
	];
}

/** A tool call Kilo is still running (`toolContent` builds finished ones). */
function runningTool(id: string, name: string, input: Content, metadata?: Content): Content {
	const created = nextCreated();
	return {
		type: "tool",
		id,
		name,
		executed: false,
		state: { status: "running", input, ...(metadata ? { metadata } : {}) },
		time: { created, ran: created },
	};
}

const writePlan = (content = PLAN) =>
	toolContent("call_write", "write", { path: PLAN_PATH, content });
const planExit = (input: Content = {}) => toolContent("call_exit", "plan_exit", input);

const task = (callID: string, childId: string, description: string, status = "completed") => {
	const input = { description, agent: "explore" };
	const metadata = { sessionID: childId };
	return status === "completed"
		? toolContent(callID, "subagent", input, "Done", metadata)
		: runningTool(callID, "subagent", input, metadata);
};

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
	userMessage(`${childId}_u`, "Look into it"),
	assistantMessage(`${childId}_a`, [textContent(text)]),
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
			.poll(() => fake.requestsTo("POST", "/api/session/ses_a/form/que_plan/reply")[0]?.body, WAIT)
			.toEqual({ answer: { q0: "Continue here" } });
		await expect.element(card().getByTestId("kilo-plan-approved")).toBeVisible();
	});

	it("stops the turn's work timer once the plan is handed over, though Kilo stays busy", async () => {
		// The step that wrote the plan still has the plan_exit call to make.
		const fake = server(planTurn([writePlan()], { finish: "tool-calls" }));
		await show(fake);
		// Kilo's turn waits on the follow-up, so the chat is busy while it is asked.
		fake.startTurn("ses_a");
		await expect.element(page.getByTestId("kilo-turn-working"), WAIT).toBeVisible();

		// Kilo's next step makes the plan_exit call.
		const exit = { sessionID: "ses_a", assistantMessageID: "msg_3", id: "call_exit" };
		fake.emit("session.step.started", {
			sessionID: "ses_a",
			assistantMessageID: "msg_3",
			agent: "plan",
			model: { providerID: "kilo", id: "test-model" },
			started: Date.now(),
		});
		fake.emit("session.tool.input.started", { ...exit, name: "plan_exit" });
		fake.emit("session.tool.called", { ...exit, input: {}, executed: true });
		fake.emit("session.tool.success", { ...exit, content: [{ type: "text", text: "" }] });
		fake.emit("session.step.ended", {
			sessionID: "ses_a",
			assistantMessageID: "msg_3",
			finish: "tool-calls",
			rawFinish: "tool-calls",
			tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
			cost: 0,
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
			.poll(() => fake.requestsTo("DELETE", "/api/session/ses_a/form/que_refine").length, WAIT)
			.toBe(1);
		await expect
			.poll(() => JSON.stringify(fake.requestsTo("POST", "/api/session/ses_a/prompt")), WAIT)
			.toContain("Keep it to one file");
		expect(fake.requestsTo("POST", "/api/session/ses_a/form/que_refine/reply")).toHaveLength(0);
		await expect.element(page.getByText("Keep it to one file"), WAIT).toBeVisible();
	});

	it("refines on Enter while Kilo waits on the follow-up", async () => {
		const fake = server(planTurn());
		await show(fake);
		// Kilo's turn waits on the question, so the chat is busy while it is asked.
		fake.startTurn("ses_a");
		fake.askQuestion("ses_a", planFollowup("que_enter"));
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();

		await userEvent.fill(page.getByTestId("kilo-composer-input"), "Smaller steps");
		await userEvent.keyboard("{Enter}");

		await expect
			.poll(() => fake.requestsTo("DELETE", "/api/session/ses_a/form/que_enter").length, WAIT)
			.toBe(1);
		// The finished plan turn stays folded while Kilo winds down.
		await expect.element(page.getByTestId("kilo-composer-refine")).not.toBeInTheDocument();
		expect(document.querySelector('[data-qa-id="kilo-turn-working"]')).toBeNull();
		// Rejecting ends Kilo's turn; the queued refinement goes out once the chat is idle.
		fake.endTurn("ses_a");
		await expect
			.poll(() => JSON.stringify(fake.requestsTo("POST", "/api/session/ses_a/prompt")), WAIT)
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
		const fake = server(planTurn([runningTool("call_write", "write", { path: PLAN_PATH })]));
		const host = await show(fake);
		await expect.element(page.getByTestId("kilo-plan-writing"), WAIT).toBeVisible();
		host.view.unmount();

		await show(
			server(
				planTurn([
					writePlan(),
					toolContent("call_exit", "plan_exit", {}, { error: "The plan was rejected" }),
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
					toolContent("call_code", "write", { path: "src/app.ts", content: "x" }),
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
			.poll(() => fake.requestsTo("POST", "/api/session/ses_a/form/que_pane/reply")[0]?.body, WAIT)
			.toEqual({ answer: { q0: "Continue here" } });
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
			.poll(() => fake.requestsTo("POST", "/api/session/ses_a/form/que_follow/reply").length, WAIT)
			.toBe(1);
		// The fake announces the answer (`form.replied`); Kilo then switches to the build agent.
		fake.chats.get("ses_a")!.agent = "code";
		fake.emit("session.agent.selected", { sessionID: "ses_a", agent: "code" });

		await expect.element(agent, WAIT).toHaveTextContent("Code");
	});

	it("asks for the plan to be implemented when Kilo asked nothing", async () => {
		const fake = server(planTurn());
		await show(fake, { otherPanes: [planPaneOf("ses_a")] });

		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);

		await vi.waitFor(
			() => expect(fake.requestsTo("POST", "/api/session/ses_a/prompt")).toHaveLength(1),
			WAIT,
		);
		expect(fake.requestsTo("POST", "/api/session/ses_a/agent").at(-1)?.body).toEqual({
			agent: "code",
		});
		const body = fake.requestsTo("POST", "/api/session/ses_a/prompt")[0]!.body as { text: string };
		expect(body.text.split("\n")).toContain("Implement the plan above.");
		await expect.element(planPane().getByTestId("chat-pane-plan-approved")).toBeVisible();
	});

	it("says when the chat has no plan yet", async () => {
		await show(server([userMessage("msg_1", "Hello")]), {
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

		fake.askPermission("ses_c1", { id: "per_child", action: "shell", resources: ["ls"] });

		await expect.element(page.getByTestId("subagent-pane-prompt"), WAIT).toBeVisible();
		await page.getByTestId("subagent-pane-prompt").getByTestId("kilo-permission-once").click();
		await expect
			.poll(
				() => fake.requestsTo("POST", "/api/session/ses_c1/permission/per_child/reply")[0]?.body,
				WAIT,
			)
			.toMatchObject({ decision: "once" });
	});

	it("offers no fork on the child's messages", async () => {
		const fake = server(planTurn([task("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: [
				...childReply("ses_c1", "Reading login.ts"),
				userMessage("ses_c1_u2", "Look again"),
				assistantMessage("ses_c1_a2", [textContent("Still fine")]),
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
		await show(server([userMessage("msg_1", "Hello")]), {
			otherPanes: [subagentPaneRecord("ses_gone", { chatId: "ses_a" })],
		});

		await expect.element(page.getByTestId("subagent-pane-unavailable"), WAIT).toBeVisible();
	});
});

describe("running subagents", () => {
	async function working() {
		const fake = server(planTurn([task("call_t1", "ses_c1", "Audit login", "running")]), {
			ses_c1: childReply("ses_c1", "Working"),
		});
		const host = await show(fake);
		fake.startTurn("ses_c1");
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
			() => expect(fake.requestsTo("POST", "/api/session/ses_c1/interrupt")).toHaveLength(1),
			WAIT,
		);
	});
});
