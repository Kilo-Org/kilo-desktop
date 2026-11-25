import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import type {
	FormInfo,
	SessionMessageAssistantTool,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode";

import {
	chatPaneObject,
	PLAN_PANE_KIND,
	SUBAGENT_PANE_KIND,
	subagentPaneId,
} from "../../contracts";
import { agentPane, chatSummary, workSession } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	idleMessage,
	questionForm,
	session,
	text,
	tool,
	userMessage,
} from "../../test/kilo2/fixtures";
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

/** Kilo's plan follow-up form: its answers carry the label keys that identify it. */
const planFollowup = (): FormInfo => {
	const form = questionForm("ses_a", [
		{
			question: "Ready to implement?",
			header: "Implement",
			options: ["Start new session", "Continue here", "Keep refining"],
		},
	]);
	return {
		...form,
		metadata: {
			kind: "question",
			kilocode: {
				options: {
					q0: {
						"Start new session": { labelKey: "plan.followup.answer.newSession" },
						"Continue here": { labelKey: "plan.followup.answer.continue", mode: "code" },
						"Keep refining": { labelKey: "plan.followup.answer.keepRefining", mode: "plan" },
					},
				},
			},
		},
	};
};

/** A tool call in `state` (completed with `metadata` by default). */
const call = (
	name: string,
	id: string,
	input: Record<string, unknown>,
	state: Partial<SessionMessageAssistantTool["state"]> & Record<string, unknown> = {},
): SessionMessageAssistantTool => {
	const base = tool(name, input, "", { id });
	return { ...base, state: { ...base.state, ...state } as SessionMessageAssistantTool["state"] };
};

function planTurn(tools = [writePlan(), planExit()]): SessionMessageInfo[] {
	return [
		userMessage("Plan the login fix", { id: "msg_1" }),
		assistantMessage(tools, { id: "msg_2", agent: "plan" }),
		idleMessage(),
	];
}

const writePlan = (content = PLAN) => call("write", "call_write", { path: PLAN_PATH, content });
const planExit = (plan = PLAN_PATH) => call("plan_exit", "call_exit", {}, { metadata: { plan } });

const subagent = (
	id: string,
	childId: string,
	description: string,
	status: "completed" | "running" = "completed",
) => {
	const input = { agent: "explore", description, prompt: "Look into it" };
	return status === "completed"
		? call("subagent", id, input, {
				content: [{ type: "text", text: "Done" }],
				metadata: { sessionID: childId },
			})
		: call("subagent", id, input, {
				status: "running",
				input,
				metadata: { sessionID: childId },
			});
};

function server(
	messages: SessionMessageInfo[],
	children: Record<string, SessionMessageInfo[]> = {},
) {
	const fake = new FakeKilo2Server();
	fake.addChat(session("ses_a", { title: "Chat" }), messages);
	for (const [id, childMessages] of Object.entries(children)) {
		fake.addChat(session(id, { title: id, parentID: "ses_a" }), childMessages);
	}
	return fake;
}

async function show(
	fake: FakeKilo2Server,
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

const childReply = (text_: string): SessionMessageInfo[] => [
	userMessage("Look into it"),
	assistantMessage([text(text_)]),
	idleMessage(),
];

const formReplies = (fake: FakeKilo2Server, form: FormInfo) =>
	fake.requestsTo("POST", `/api/session/ses_a/form/${form.id}/reply`).map(({ body }) => body);

const formCancels = (fake: FakeKilo2Server, form: FormInfo) =>
	fake.requestsTo("DELETE", `/api/session/ses_a/form/${form.id}`);

const promptTexts = (fake: FakeKilo2Server) =>
	fake
		.requestsTo("POST", "/api/session/ses_a/prompt")
		.map(({ body }) => (body as { text?: string }).text);

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

		const form = fake.createForm(planFollowup());
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();
		await card().getByTestId("kilo-plan-approve").click();

		await expect
			.poll(() => formReplies(fake, form)[0], WAIT)
			.toEqual({ answer: { q0: "Continue here" } });
		await expect.element(card().getByTestId("kilo-plan-approved")).toBeVisible();
	});

	it("stops the turn's work timer once the plan is handed over, though Kilo stays busy", async () => {
		const fake = new FakeKilo2Server();
		fake.addChat(session("ses_a", { title: "Chat", agent: "plan" }), [
			userMessage("Plan the login fix", { id: "msg_1" }),
		]);
		await show(fake);
		// Kilo's turn waits on the follow-up, so the chat is busy while it is asked.
		const step = fake.startTurn("ses_a").step();
		step.tool("write", { path: PLAN_PATH, content: PLAN }, "", "call_write");
		await expect.element(page.getByTestId("kilo-turn-working"), WAIT).toBeVisible();

		step.call("plan_exit", {}, "call_exit").succeed("", { plan: PLAN_PATH });
		step.end();
		fake.createForm(planFollowup());
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();
		await expect.element(page.getByTestId("kilo-turn-working")).not.toBeInTheDocument();
	});

	// Kilo stores a typed follow-up answer as a hidden synthetic message, so refining
	// dismisses the follow-up and sends the text as an ordinary, visible prompt.
	it("refines the plan by sending what the person types as a visible message", async () => {
		const fake = server(planTurn());
		await show(fake);
		const form = fake.createForm(planFollowup());
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-question-card"]')).toBeNull();

		await userEvent.fill(page.getByTestId("kilo-composer-input"), "Keep it to one file");
		await page.getByTestId("kilo-composer-refine").click();

		await expect.poll(() => formCancels(fake, form).length, WAIT).toBe(1);
		await expect.poll(() => promptTexts(fake), WAIT).toContain("Keep it to one file");
		expect(formReplies(fake, form)).toHaveLength(0);
		await expect.element(page.getByText("Keep it to one file"), WAIT).toBeVisible();
	});

	it("refines on Enter while Kilo waits on the follow-up", async () => {
		const fake = server(planTurn());
		await show(fake);
		// Kilo's turn waits on the question, so the chat is busy while it is asked.
		const turn = fake.startTurn("ses_a");
		const form = fake.createForm(planFollowup());
		await expect.element(page.getByTestId("kilo-composer-refine"), WAIT).toBeVisible();

		await userEvent.fill(page.getByTestId("kilo-composer-input"), "Smaller steps");
		await userEvent.keyboard("{Enter}");

		await expect.poll(() => formCancels(fake, form).length, WAIT).toBe(1);
		// The finished plan turn stays folded while Kilo winds down.
		await expect.element(page.getByTestId("kilo-composer-refine")).not.toBeInTheDocument();
		expect(document.querySelector('[data-qa-id="kilo-turn-working"]')).toBeNull();
		// Rejecting ends Kilo's turn; the queued refinement goes out once the chat is idle.
		turn.succeed();
		await expect.poll(() => promptTexts(fake), WAIT).toContain("Smaller steps");
	});

	it("shows a plan handed over by plan_exit alone, read from its file", async () => {
		const fake = server(planTurn([planExit()]));
		fake.files[PLAN_PATH] = "# From disk\n\nRead the plan file";
		await show(fake);

		await expect.element(card().getByText("From disk"), WAIT).toBeVisible();
		await expect.element(card().getByText("Read the plan file")).toBeVisible();
	});

	it("says the plan is being written, and why the hand-over failed", async () => {
		const fake = server(
			planTurn([
				call(
					"write",
					"call_write",
					{ path: PLAN_PATH },
					{ status: "running", input: { path: PLAN_PATH }, metadata: {} },
				),
			]),
		);
		const host = await show(fake);
		await expect.element(page.getByTestId("kilo-plan-writing"), WAIT).toBeVisible();
		host.view.unmount();

		await show(
			server(
				planTurn([
					writePlan(),
					call(
						"plan_exit",
						"call_exit",
						{},
						{
							status: "error",
							input: {},
							error: { type: "tool", message: "The plan was rejected" },
						},
					),
				]),
			),
		);
		await expect.element(page.getByText("The plan was rejected"), WAIT).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-plan-approve"]')).toBeNull();
	});

	it("leaves edits to files that aren't plans as diffs", async () => {
		await show(
			server(
				planTurn([writePlan(), call("write", "call_code", { path: "src/app.ts", content: "x" })]),
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
		const form = fake.createForm(planFollowup());
		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);

		await expect
			.poll(() => formReplies(fake, form)[0], WAIT)
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

		const form = fake.createForm(planFollowup());
		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);
		await expect.poll(() => formReplies(fake, form).length, WAIT).toBe(1);
		// Kilo carries on with the code agent once the follow-up is answered.
		fake.emit("session.agent.selected", { agent: "code" }, "ses_a");

		await expect.element(agent, WAIT).toHaveTextContent("Code");
	});

	it("asks for the plan to be implemented when Kilo asked nothing", async () => {
		const fake = server(planTurn());
		await show(fake, { otherPanes: [planPaneOf("ses_a")] });

		await planPane().getByTestId("chat-pane-plan-approve").click(WAIT);

		await expect.poll(() => promptTexts(fake), WAIT).toEqual(["Implement the plan above."]);
		expect(fake.chat("ses_a")?.agent).toBe("code");
		await expect.element(planPane().getByTestId("chat-pane-plan-approved")).toBeVisible();
	});

	it("says when the chat has no plan yet", async () => {
		await show(server([userMessage("Hello")]), {
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
				subagent("call_t1", "ses_c1", "Audit login"),
				subagent("call_t2", "ses_c2", "Audit logout"),
			]),
			{ ses_c1: childReply("Login is fine"), ses_c2: childReply("Logout") },
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
		const fake = server(planTurn([subagent("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: childReply("Reading login.ts"),
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
		const fake = server(planTurn([subagent("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: [
				...childReply("Reading login.ts"),
				userMessage("Look again"),
				assistantMessage([text("Still fine")]),
				idleMessage(),
			],
		});
		await show(fake, {
			otherPanes: [subagentPaneRecord("ses_c1", { chatId: "ses_a" })],
		});

		await expect.element(subagentPane().getByText("Still fine"), WAIT).toBeVisible();
		expect(subagentPane().getByTestId("kilo-fork-from-here-button").elements()).toHaveLength(0);
	});

	it("finds the delegating chat of origin's pane through kilo.core", async () => {
		const fake = server(planTurn([subagent("call_t1", "ses_c1", "Audit login")]), {
			ses_c1: childReply("Origin's child"),
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
		await show(server([userMessage("Hello")]), {
			otherPanes: [subagentPaneRecord("ses_gone", { chatId: "ses_a" })],
		});

		await expect.element(page.getByTestId("subagent-pane-unavailable"), WAIT).toBeVisible();
	});
});

describe("running subagents", () => {
	async function working() {
		const fake = server(planTurn([subagent("call_t1", "ses_c1", "Audit login", "running")]), {
			ses_c1: childReply("Working"),
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

	it("stops one subagent from its row through kilo.core", async () => {
		const { host } = await working();
		const stop = () => document.querySelector('[aria-label="Stop subagent: Audit login"]');
		await expandUntil([turnWork], () => expect(stop()).not.toBeNull());

		(stop() as HTMLElement).click();

		await vi.waitFor(
			() => expect(host.agent.calls.abort).toHaveBeenCalledWith({ id: "ses_c1" }),
			WAIT,
		);
	});
});
