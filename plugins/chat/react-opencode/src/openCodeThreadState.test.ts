import { describe, expect, it } from "vitest";

import {
	createOpenCodeThreadState,
	isQuestionForm,
	questionsOfForm,
	reduceOpenCodeThreadState,
} from "./openCodeThreadState";
import {
	assistant,
	permissionRequest,
	questionForm,
	serverEvent,
	session,
	SESSION_ID,
	text,
	threadState,
	user,
} from "./testUtils";
import type { OpenCodeStateEvent, OpenCodeThreadState, PendingUserMessage } from "./types";

const reduce = (state: OpenCodeThreadState, ...events: OpenCodeStateEvent[]) =>
	events.reduce(reduceOpenCodeThreadState, state);

const onServer = (type: string, data: Record<string, unknown> = {}): OpenCodeStateEvent => ({
	type: "server.event",
	event: serverEvent(type, data),
});

const ids = (state: OpenCodeThreadState) => state.messages.map((message) => message.id);

const pending = (clientId: string): PendingUserMessage => ({
	clientId,
	sessionId: SESSION_ID,
	createdAt: 1,
	parts: [{ type: "text", text: "hello" }],
	status: "pending",
});

describe("reduceOpenCodeThreadState: history", () => {
	it("loads a session's newest page and whether it runs", () => {
		const state = reduce(
			createOpenCodeThreadState(SESSION_ID),
			{ type: "history.loading" },
			{
				type: "history.loaded",
				session: session(),
				messages: [user("msg_1"), assistant("msg_2")],
				running: true,
				olderHistory: { type: "available", cursor: "c1" },
			},
		);

		expect(state).toMatchObject({
			session: { id: SESSION_ID },
			running: true,
			runState: { type: "streaming" },
			loadState: { type: "ready" },
			olderHistory: { type: "available", cursor: "c1" },
		});
		expect(ids(state)).toEqual(["msg_1", "msg_2"]);
	});

	it("keeps older messages already held when a reload brings only the newest page", () => {
		const held = threadState([
			user("msg_1"),
			assistant("msg_2"),
			user("msg_3"),
			assistant("msg_4"),
		]);

		const reloaded = reduce(held, {
			type: "history.loaded",
			session: session(),
			messages: [user("msg_3"), assistant("msg_4"), user("msg_5")],
			running: false,
			olderHistory: { type: "available", cursor: "c1" },
		});

		expect(ids(reloaded)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4", "msg_5"]);
	});

	it("takes a complete history as it is", () => {
		const held = threadState([user("msg_1"), assistant("msg_2"), user("msg_3")]);

		const reloaded = reduce(held, {
			type: "history.loaded",
			session: session(),
			messages: [user("msg_3")],
			running: false,
		});

		expect(ids(reloaded)).toEqual(["msg_3"]);
		expect(reloaded.olderHistory).toEqual({ type: "complete" });
	});

	it("prepends older pages ahead of everything held, skipping messages already held", () => {
		const state = reduce(
			threadState([user("msg_3"), assistant("msg_4")], {
				olderHistory: { type: "available", cursor: "c1" },
			}),
			{ type: "history.olderLoading" },
		);
		expect(state.olderHistory).toEqual({ type: "loading", cursor: "c1" });

		const prepended = reduce(state, {
			type: "history.prepended",
			messages: [user("msg_1"), assistant("msg_2"), user("msg_3")],
			olderHistory: { type: "complete" },
		});

		expect(ids(prepended)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
		expect(prepended.olderHistory).toEqual({ type: "complete" });
	});

	it("records a failed older page with its cursor, for a retry", () => {
		const error = new Error("offline");
		const state = reduce(threadState([], { olderHistory: { type: "loading", cursor: "c1" } }), {
			type: "history.olderFailed",
			error,
		});

		expect(state.olderHistory).toEqual({ type: "failed", cursor: "c1", error });
	});

	it("records a failed load", () => {
		const error = new Error("offline");

		expect(
			reduce(createOpenCodeThreadState(SESSION_ID), { type: "history.failed", error }).loadState,
		).toEqual({
			type: "error",
			error,
		});
	});

	it("keeps a cancelling run cancelling when a reload says the session still runs", () => {
		const state = reduce(threadState([], { runState: { type: "cancelling" } }), {
			type: "history.loaded",
			session: session(),
			messages: [],
			running: true,
		});

		expect(state.runState).toEqual({ type: "cancelling" });
	});
});

describe("reduceOpenCodeThreadState: running", () => {
	it("runs from an execution start until the execution ends", () => {
		const started = reduce(threadState([user("msg_1")]), onServer("session.execution.started"));
		expect(started).toMatchObject({ running: true, runState: { type: "streaming" } });

		const ended = reduce(started, onServer("session.execution.succeeded"));
		expect(ended).toMatchObject({ running: false, runState: { type: "idle" } });
		expect(ended.messages.at(-1)).toMatchObject({ type: "idle", outcome: "succeeded" });
	});

	it.each(["cancelling", "reverting"] as const)(
		"keeps a %s run while the session still runs",
		(type) => {
			const state = reduce(threadState([], { runState: { type } }), {
				type: "status",
				running: true,
			});

			expect(state.runState).toEqual({ type });
		},
	);
});

describe("reduceOpenCodeThreadState: pending prompts", () => {
	it("drops a pending prompt once the server message with its id arrives on the stream", () => {
		const queued = reduce(threadState(), {
			type: "local.message.queued",
			pending: pending("msg_p"),
		});
		expect(Object.keys(queued.pendingUserMessages)).toEqual(["msg_p"]);

		const admitted = reduce(
			queued,
			onServer("session.inbox.enqueued", {
				inboxID: "msg_p",
				item: { type: "user", payload: { text: "hello" }, delivery: "queue" },
			}),
		);

		expect(admitted.pendingUserMessages).toEqual({});
		expect(ids(admitted)).toEqual(["msg_p"]);
	});

	it("drops a pending prompt the loaded history holds", () => {
		const queued = reduce(threadState(), {
			type: "local.message.queued",
			pending: pending("msg_p"),
		});

		const loaded = reduce(queued, {
			type: "history.loaded",
			session: session(),
			messages: [user("msg_p", "hello")],
			running: false,
		});

		expect(loaded.pendingUserMessages).toEqual({});
	});

	it("keeps a pending prompt the server hasn't admitted", () => {
		const queued = reduce(threadState(), {
			type: "local.message.queued",
			pending: pending("msg_p"),
		});

		const updated = reduce(queued, {
			type: "history.loaded",
			session: session(),
			messages: [user("msg_other")],
			running: false,
		});

		expect(Object.keys(updated.pendingUserMessages)).toEqual(["msg_p"]);
	});

	it("marks a prompt that failed to send", () => {
		const error = new Error("Unauthorized");
		const state = reduce(
			threadState(),
			{ type: "local.message.queued", pending: pending("msg_p") },
			{ type: "local.message.failed", clientId: "msg_p", error },
		);

		expect(state.pendingUserMessages.msg_p).toMatchObject({ status: "failed", error });
		expect(state.runState).toEqual({ type: "error", error });
	});
});

describe("reduceOpenCodeThreadState: permissions", () => {
	it("holds an asked permission until it is replied to, keeping the request", () => {
		const request = permissionRequest("per_1", {
			source: { type: "tool", messageID: "msg_2", id: "call_1" },
		});
		const asked = reduce(threadState(), onServer("permission.asked", request));
		expect(asked.interactions.permissions.pending.per_1).toEqual(request);

		const replied = reduce(
			asked,
			onServer("permission.replied", { requestID: "per_1", reply: "always" }),
		);

		expect(replied.interactions.permissions.pending).toEqual({});
		expect(replied.interactions.permissions.resolved.per_1).toMatchObject({
			request,
			reply: "always",
		});
	});

	it("ignores a permission asked twice", () => {
		const asked = reduce(threadState(), onServer("permission.asked", permissionRequest("per_1")));

		expect(reduce(asked, onServer("permission.asked", permissionRequest("per_1")))).toBe(asked);
	});

	it("records the controller's own reply", () => {
		const state = reduce(threadState(), onServer("permission.asked", permissionRequest("per_1")), {
			type: "permission.replied",
			permissionId: "per_1",
			reply: "reject",
		});

		expect(state.interactions.permissions.resolved.per_1?.reply).toBe("reject");
	});

	it("replaces the pending permissions with those the server lists", () => {
		const state = reduce(
			threadState(),
			onServer("permission.asked", permissionRequest("per_gone")),
			{ type: "permissions.loaded", requests: [permissionRequest("per_1")] },
		);

		expect(Object.keys(state.interactions.permissions.pending)).toEqual(["per_1"]);
	});
});

describe("reduceOpenCodeThreadState: question forms", () => {
	it("holds a created question form apart from permissions", () => {
		const form = questionForm("frm_1");
		const state = reduce(threadState(), onServer("form.created", { form }));

		expect(state.interactions.questions.pending.frm_1).toEqual(form);
		expect(state.interactions.permissions.pending).toEqual({});
	});

	it("ignores forms that aren't the question tool's", () => {
		const initial = threadState();
		const form = { ...questionForm("frm_1"), metadata: { kind: "mcp" } };

		expect(reduce(initial, onServer("form.created", { form }))).toBe(initial);
	});

	it("records a reply's answers as labels per question, keeping the form", () => {
		const form = questionForm("frm_1", [
			{ header: "Pick", question: "Which?", options: ["A", "B"] },
			{ header: "Many", question: "Which ones?", options: ["X", "Y"], multiple: true },
			{ header: "Skip", question: "Optional?", options: [] },
		]);
		const state = reduce(
			threadState(),
			onServer("form.created", { form }),
			onServer("form.replied", { id: "frm_1", answer: { q0: "A", q1: ["X", "Y"], q2: "" } }),
		);

		expect(state.interactions.questions.pending).toEqual({});
		expect(state.interactions.questions.answered.frm_1).toMatchObject({
			request: form,
			answers: [["A"], ["X", "Y"], []],
		});
	});

	it("records a cancelled form as rejected", () => {
		const state = reduce(
			threadState(),
			onServer("form.created", { form: questionForm("frm_1") }),
			onServer("form.cancelled", { id: "frm_1" }),
		);

		expect(state.interactions.questions.rejected.frm_1?.request.id).toBe("frm_1");
		expect(state.interactions.questions.pending).toEqual({});
	});

	it("loads only the question forms the server lists", () => {
		const state = reduce(threadState(), {
			type: "questions.loaded",
			forms: [questionForm("frm_q"), { ...questionForm("frm_other"), metadata: {} }],
		});

		expect(Object.keys(state.interactions.questions.pending)).toEqual(["frm_q"]);
	});

	it("records the controller's own answers and rejections", () => {
		const asked = reduce(
			threadState(),
			onServer("form.created", { form: questionForm("frm_1") }),
			onServer("form.created", { form: questionForm("frm_2") }),
		);
		const settled = reduce(
			asked,
			{ type: "question.replied", questionId: "frm_1", answers: [["Yes"]] },
			{ type: "question.rejected", questionId: "frm_2" },
		);

		expect(settled.interactions.questions.answered.frm_1?.answers).toEqual([["Yes"]]);
		expect(settled.interactions.questions.rejected.frm_2).toBeDefined();
	});
});

describe("reduceOpenCodeThreadState: session info", () => {
	it("follows a rename", () => {
		const state = reduce(threadState(), onServer("session.renamed", { title: "Fix the build" }));

		expect(state.session?.title).toBe("Fix the build");
	});

	it("applies a staged revert and clears it", () => {
		const revert = { messageID: "msg_3" };
		const staged = reduce(threadState(), onServer("session.revert.staged", { revert }));
		expect(staged.session?.revert).toEqual(revert);

		const cleared = reduce(staged, onServer("session.revert.cleared"));
		expect(cleared.session).not.toHaveProperty("revert");
	});

	it("drops the reverted messages and the staged revert once committed", () => {
		const state = reduce(
			threadState([user("msg_1"), assistant("msg_2", [text("a")]), user("msg_3")], {
				session: session(SESSION_ID, { revert: { messageID: "msg_3" } }),
			}),
			onServer("session.revert.committed", { to: "msg_3" }),
		);

		expect(ids(state)).toEqual(["msg_1", "msg_2"]);
		expect(state.session).not.toHaveProperty("revert");
	});

	it("ignores session info events before the session has loaded", () => {
		const initial = createOpenCodeThreadState(SESSION_ID);

		expect(reduce(initial, onServer("session.renamed", { title: "x" }))).toBe(initial);
	});

	it("replaces the session with the controller's own copy", () => {
		const next = session(SESSION_ID, { title: "Mine" });

		expect(reduce(threadState(), { type: "session.info", session: next }).session).toBe(next);
	});
});

describe("question forms", () => {
	it("recognises the question tool's forms by their kind", () => {
		expect(isQuestionForm(questionForm("frm_1"))).toBe(true);
		expect(isQuestionForm({ metadata: { kind: "other" } })).toBe(false);
		expect(isQuestionForm(undefined)).toBe(false);
	});

	it("reads one question per field, in order", () => {
		const form = questionForm("frm_1", [
			{ header: "Pick", question: "Which one?", options: ["A", "B"] },
			{ header: "Many", question: "Which ones?", options: ["X"], multiple: true },
		]);

		expect(questionsOfForm(form)).toEqual([
			{
				key: "q0",
				question: "Which one?",
				header: "Pick",
				options: [{ label: "A" }, { label: "B" }],
				multiple: false,
				custom: true,
			},
			{
				key: "q1",
				question: "Which ones?",
				header: "Many",
				options: [{ label: "X" }],
				multiple: true,
				custom: true,
			},
		]);
	});

	it("keeps option descriptions and falls back to an option's value and the field's title", () => {
		const form = {
			...questionForm("frm_1"),
			fields: [
				{
					key: "q0",
					title: "Mode",
					type: "string",
					options: [
						{ value: "fast", description: "Quick" },
						{ value: "slow", label: "Slow" },
					],
				},
			],
		} as never;

		expect(questionsOfForm(form)).toEqual([
			{
				key: "q0",
				question: "Mode",
				header: "Mode",
				options: [{ label: "fast", description: "Quick" }, { label: "Slow" }],
				multiple: false,
				custom: false,
			},
		]);
	});
});
