import type { OpenCodeEvent, SessionMessageInfo } from "@kilocode/client";
import { describe, it, expect } from "vitest";
import { createOpenCodeThreadState, reduceOpenCodeThreadState } from "./openCodeThreadState";
import type { OpenCodeStateEvent, OpenCodeThreadState, PendingUserMessage } from "./types";

const pendingMessage = (patch: Partial<PendingUserMessage> = {}): PendingUserMessage => ({
	clientId: "local_1",
	messageId: "msg_u1",
	sessionId: "ses_1",
	createdAt: 1000,
	parentId: null,
	sourceId: null,
	runConfig: undefined,
	contentText: "hello world",
	parts: [{ type: "text", text: "hello world" }],
	status: "pending",
	...patch,
});

const kilo = (type: string, data: Record<string, unknown>, created = 10): OpenCodeStateEvent => ({
	type: "kilo.event",
	event: { type, data: { sessionID: "ses_1", ...data }, created } as unknown as OpenCodeEvent,
});

const reduce = (state: OpenCodeThreadState, ...events: OpenCodeStateEvent[]) =>
	events.reduce(reduceOpenCodeThreadState, state);

const user = (id: string, text: string, created: number): SessionMessageInfo => ({
	id,
	type: "user",
	text,
	time: { created },
});

const stepStarted = (id: string) =>
	kilo("session.step.started", {
		assistantMessageID: id,
		agent: "code",
		model: { providerID: "kilo", id: "m" },
		started: 20,
	});

describe("reduceOpenCodeThreadState", () => {
	it("drops a pending prompt once the history holds the message it was sent as", () => {
		const queued = reduce(createOpenCodeThreadState("ses_1"), {
			type: "local.message.queued",
			pending: pendingMessage(),
		});
		const unrelated = reduce(queued, {
			type: "history.loaded",
			session: null,
			messages: [user("msg_other", "hello world", 1000)],
		});
		expect(Object.keys(unrelated.pendingUserMessages)).toEqual(["local_1"]);

		const loaded = reduce(queued, {
			type: "history.loaded",
			session: null,
			messages: [user("msg_u1", "hello world", 1000)],
		});
		expect(loaded.pendingUserMessages).toEqual({});
		expect(loaded.messageOrder).toEqual(["msg_u1"]);
		expect(loaded.loadState).toEqual({ type: "ready" });
	});

	it("drops a pending prompt when its message is delivered live", () => {
		const delivered = reduce(
			createOpenCodeThreadState("ses_1"),
			{ type: "local.message.queued", pending: pendingMessage() },
			kilo("session.inbox.enqueued", {
				inboxID: "msg_u1",
				item: { type: "user", delivery: "steer", payload: { text: "hello world" } },
			}),
		);
		expect(Object.keys(delivered.pendingUserMessages)).toEqual(["local_1"]);
		expect(Object.keys(delivered.inbox)).toEqual(["msg_u1"]);

		const after = reduce(delivered, kilo("session.inbox.delivered", { inboxID: "msg_u1" }, 1001));
		expect(after.pendingUserMessages).toEqual({});
		expect(after.messagesById.msg_u1).toEqual(user("msg_u1", "hello world", 1001));
	});

	it("takes a prompt delivered under another id (a slash command's) for the one pending copy", () => {
		const delivered = reduce(
			createOpenCodeThreadState("ses_1"),
			{ type: "local.message.queued", pending: pendingMessage({ contentText: "/review" }) },
			kilo("session.inbox.enqueued", {
				inboxID: "msg_cmd",
				item: { type: "user", delivery: "steer", payload: { text: "Review the code" } },
			}),
			kilo("session.inbox.delivered", { inboxID: "msg_cmd" }, 1001),
		);
		expect(delivered.pendingUserMessages).toEqual({});
	});

	it("runs while the turn executes, retries, and goes idle when it ends", () => {
		const running = reduce(
			createOpenCodeThreadState("ses_1"),
			kilo("session.execution.started", {}),
		);
		expect(running.sessionStatus).toEqual({ type: "busy" });
		expect(running.runState).toEqual({ type: "streaming" });

		const retrying = reduce(
			running,
			stepStarted("msg_a1"),
			kilo("session.retry.scheduled", {
				assistantMessageID: "msg_a1",
				attempt: 2,
				at: 50,
				error: { type: "rate", message: "Too many requests" },
			}),
		);
		expect(retrying.sessionStatus).toEqual({
			type: "retry",
			attempt: 2,
			message: "Too many requests",
			next: 50,
		});

		const idle = reduce(retrying, kilo("session.execution.succeeded", {}));
		expect(idle.sessionStatus).toEqual({ type: "idle" });
		expect(idle.runState).toEqual({ type: "idle" });
	});

	it("streams text into the step, marking the thread active unless it is stopping", () => {
		const streamed = reduce(
			createOpenCodeThreadState("ses_1"),
			stepStarted("msg_a1"),
			kilo("session.text.started", { assistantMessageID: "msg_a1", ordinal: 0 }),
			kilo("session.text.delta", { assistantMessageID: "msg_a1", ordinal: 0, delta: "Hi" }),
		);
		expect(streamed.runState).toEqual({ type: "streaming" });
		const step = streamed.messagesById.msg_a1;
		expect(step?.type === "assistant" && step.content).toEqual([{ type: "text", text: "Hi" }]);

		const cancelling = reduce(streamed, { type: "run.cancelling" });
		expect(
			reduce(
				cancelling,
				kilo("session.text.delta", { assistantMessageID: "msg_a1", ordinal: 0, delta: "!" }),
			).runState,
		).toEqual({ type: "cancelling" });
	});

	it("applies the session's changes from its events", () => {
		const loaded = reduce(createOpenCodeThreadState("ses_1"), {
			type: "history.loaded",
			session: { id: "ses_1", title: "Old", cost: 0 } as never,
			messages: [],
		});
		const renamed = reduce(loaded, kilo("session.renamed", { title: "New" }));
		expect(renamed.session?.title).toBe("New");
		expect(reduce(renamed, kilo("project.updated", {}))).toBe(renamed);
	});

	it("keeps older messages a reload has not reached while the older history is still to come", () => {
		const full = reduce(createOpenCodeThreadState("ses_1"), {
			type: "history.loaded",
			session: null,
			messages: [user("msg_1", "a", 1), user("msg_2", "b", 2), user("msg_3", "c", 3)],
		});
		const reloaded = reduce(full, {
			type: "history.loaded",
			session: null,
			messages: [user("msg_3", "c", 3)],
			olderHistory: { type: "loading" },
		});
		expect(reloaded.messageOrder).toEqual(["msg_1", "msg_2", "msg_3"]);

		const prepended = reduce(reloaded, {
			type: "history.prepended",
			messages: [user("msg_0", "z", 0), user("msg_2", "b2", 2)],
			boundaryId: "msg_3",
		});
		expect(prepended.messageOrder).toEqual(["msg_0", "msg_2", "msg_3"]);
		expect(prepended.olderHistory).toEqual({ type: "complete" });
	});

	it("stores pending forms separately from permissions", () => {
		const initial = createOpenCodeThreadState("ses_1");

		const withForm = reduceOpenCodeThreadState(initial, {
			type: "form.created",
			request: {
				id: "frm_1",
				sessionID: "ses_1",
				title: "Questions",
				fields: [
					{
						key: "q0",
						type: "string",
						title: "Confirm",
						description: "Should I continue?",
						options: [
							{ value: "Yes", label: "Yes", description: "Continue the task." },
							{ value: "No", label: "No", description: "Stop here." },
						],
					},
				],
				askedAt: 1000,
			},
		});

		expect(withForm.interactions.forms.pending.frm_1?.fields[0]?.title).toBe("Confirm");
		expect(Object.keys(withForm.interactions.permissions.pending)).toHaveLength(0);
	});

	it("retains request details for replied forms and resolved permissions", () => {
		const initial = createOpenCodeThreadState("ses_1");

		const withPermission = reduceOpenCodeThreadState(initial, {
			type: "permission.asked",
			request: {
				id: "permission_1",
				sessionID: "ses_1",
				action: "shell",
				resources: [],
				askedAt: 1000,
				source: { type: "tool", messageID: "msg_1", id: "call_1" },
			},
		});

		const resolvedPermission = reduceOpenCodeThreadState(withPermission, {
			type: "permission.replied",
			permissionId: "permission_1",
			reply: "once",
		});

		expect(
			resolvedPermission.interactions.permissions.resolved.permission_1?.request.source?.id,
		).toBe("call_1");

		const withForm = reduceOpenCodeThreadState(initial, {
			type: "form.created",
			request: {
				id: "frm_1",
				sessionID: "ses_1",
				title: "Questions",
				fields: [{ key: "q0", type: "string", description: "Should I continue?" }],
				askedAt: 1000,
			},
		});

		const repliedForm = reduceOpenCodeThreadState(withForm, {
			type: "form.replied",
			formId: "frm_1",
			answer: { q0: "Yes" },
		});

		expect(repliedForm.interactions.forms.replied.frm_1).toMatchObject({
			request: { fields: [{ key: "q0" }] },
			answer: { q0: "Yes" },
		});
	});
});
