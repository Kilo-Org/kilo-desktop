import type { AppendMessage, ThreadUserMessagePart } from "@assistant-ui/react";
import type { SessionInfo, SessionMessagesResponse } from "@kilocode/client";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
	OPEN_CODE_HISTORY_PAGE_SIZE,
	OpenCodeThreadController,
	toFormAnswer,
	toPromptInput,
} from "./OpenCodeThreadController";
import type * as TaskSessionModule from "./openCodeTaskSession";
import {
	assistant,
	createDeferred,
	createFakeClient,
	createFakeEventSource,
	MODEL,
	permissionRequest,
	questionForm,
	runningTool,
	serverEvent,
	session,
	SESSION_ID,
	settleMicrotasks,
	streamReconnected,
	subagentTool,
	text,
	user,
	type FakeClient,
	type FakeEventSource,
} from "./testUtils";
import type { OpenCodeThreadState, Transcript } from "./types";

const getOpenCodeTaskSessionIdSpy = vi.hoisted(() => vi.fn());

vi.mock("./openCodeTaskSession", async (importOriginal) => {
	const original = await importOriginal<typeof TaskSessionModule>();
	return {
		...original,
		getOpenCodeTaskSessionId: (tool: Parameters<typeof original.getOpenCodeTaskSessionId>[0]) => {
			getOpenCodeTaskSessionIdSpy(tool);
			return original.getOpenCodeTaskSessionId(tool);
		},
	};
});

const appendMessage = (
	content: readonly ThreadUserMessagePart[],
	attachments: readonly Record<string, unknown>[] = [],
): AppendMessage =>
	({
		role: "user",
		parentId: null,
		sourceId: null,
		content,
		attachments,
		metadata: { custom: {} },
		runConfig: {},
		createdAt: new Date(),
	}) as unknown as AppendMessage;

const hello = () => appendMessage([{ type: "text", text: "hello" }]);

function setup(sessionId = SESSION_ID) {
	const fake = createFakeClient();
	const events = createFakeEventSource();
	const controller = new OpenCodeThreadController(fake.client, () => events, sessionId);
	return { fake, events, controller };
}

const ids = (state: OpenCodeThreadState) => state.messages.map((message) => message.id);

const messageIds = (count: number) =>
	Array.from({ length: count }, (_, index) => user(`msg_${String(index).padStart(4, "0")}`));

const stepStarted = (assistantMessageID: string, sessionID = SESSION_ID) =>
	serverEvent("session.step.started", {
		sessionID,
		assistantMessageID,
		agent: "code",
		model: MODEL,
		started: 1,
	});

/** A step with one subagent call per child session. */
const withSubagents = (messageId: string, children: readonly string[]) =>
	assistant(
		messageId,
		children.map((child, index) => subagentTool(`${messageId}_call_${index}`, child)),
	);

describe("toPromptInput", () => {
	it.each([
		[
			"wraps a bare base64 file",
			{ type: "file", data: "JVBERi0xLjQ=", mimeType: "application/pdf" },
			"data:application/pdf;base64,JVBERi0xLjQ=",
		],
		[
			"forwards a data URL",
			{ type: "file", data: "data:application/pdf;base64,JVBE", mimeType: "application/pdf" },
			"data:application/pdf;base64,JVBE",
		],
		[
			"forwards an http source",
			{ type: "file", data: "https://cdn.example.com/a.pdf", mimeType: "application/pdf" },
			"https://cdn.example.com/a.pdf",
		],
		[
			"re-envelopes a payload so the declared type wins",
			{
				type: "file",
				data: "data:application/octet-stream;base64,QUJD",
				mimeType: "application/pdf",
			},
			"data:application/pdf;base64,QUJD",
		],
		[
			"falls back to the envelope for an empty file type",
			{ type: "file", data: "data:application/pdf;base64,QUJD", mimeType: "" },
			"data:application/pdf;base64,QUJD",
		],
		[
			"floors an empty file type",
			{ type: "file", data: "QUJD", mimeType: "" },
			"data:application/octet-stream;base64,QUJD",
		],
		[
			"leaves an id reference unwrapped",
			{ type: "file", data: "file-abc123", mimeType: "application/pdf", sourceType: "id" },
			"file-abc123",
		],
		[
			"keeps a data URL image's declared type",
			{ type: "image", image: "data:image/jpeg;base64,QUJD" },
			"data:image/jpeg;base64,QUJD",
		],
		[
			"wraps a bare base64 image with the fallback type",
			{ type: "image", image: "QUJD" },
			"data:image/png;base64,QUJD",
		],
		[
			"forwards an http image",
			{ type: "image", image: "https://cdn.example.com/a.png" },
			"https://cdn.example.com/a.png",
		],
		[
			"sniffs a bare base64 jpeg",
			{ type: "image", image: "/9j/4AAQSkZJRg==" },
			"data:image/jpeg;base64,/9j/4AAQSkZJRg==",
		],
		[
			"sniffs a bare base64 gif",
			{ type: "image", image: "R0lGODlhAQABAA==" },
			"data:image/gif;base64,R0lGODlhAQABAA==",
		],
		[
			"sniffs a bare base64 webp",
			{ type: "image", image: "UklGRiIAAABXRUJQVlA4" },
			"data:image/webp;base64,UklGRiIAAABXRUJQVlA4",
		],
		[
			"keeps a non-base64 data URL image",
			{ type: "image", image: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E" },
			"data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
		],
		[
			"sniffs through a generic data URL envelope",
			{ type: "image", image: "data:application/octet-stream;base64,/9j/4AAQSkZJRg==" },
			"data:image/jpeg;base64,/9j/4AAQSkZJRg==",
		],
		[
			"ignores a non-image envelope on an image",
			{ type: "image", image: "data:application/octet-stream;base64,QUJD", contentType: "" },
			"data:image/png;base64,QUJD",
		],
	])("%s", (_label, part, uri) => {
		const { files } = toPromptInput([part as ThreadUserMessagePart]);

		expect(files).toEqual([{ uri }]);
		if (!uri.startsWith("file-")) expect(() => new URL(uri)).not.toThrow();
	});

	it("joins text parts and names files by their filename", () => {
		expect(
			toPromptInput([
				{ type: "text", text: "one" },
				{ type: "file", data: "QUJD", mimeType: "text/plain", filename: "a.txt" },
				{ type: "text", text: "two" },
			]),
		).toEqual({
			text: "one\n\ntwo",
			files: [{ uri: "data:text/plain;base64,QUJD", name: "a.txt" }],
		});
	});
});

describe("toFormAnswer", () => {
	it("answers each question by its field key: a multiselect with its labels, others with one string", () => {
		const form = questionForm("frm_1", [
			{ header: "One", question: "?", options: ["A", "B"] },
			{ header: "Many", question: "?", options: ["X", "Y"], multiple: true },
			{ header: "Skipped", question: "?", options: ["Z"] },
		]);

		expect(toFormAnswer(form, [["A", "custom"], ["X", "Y"], []])).toEqual({
			q0: "A, custom",
			q1: ["X", "Y"],
		});
	});
});

describe("OpenCodeThreadController: prompts", () => {
	it("switches the chat's agent and model, then prompts with the pending message's id", async () => {
		const { fake, controller } = setup();

		await controller.sendMessage(hello(), {
			agent: "plan",
			model: { providerID: "acme", modelID: "fast-1" },
		});

		const [clientId] = Object.keys(controller.getState().pendingUserMessages);
		expect(fake.session.switchAgent).toHaveBeenCalledWith({ sessionID: SESSION_ID, agent: "plan" });
		expect(fake.session.switchModel).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			model: { providerID: "acme", id: "fast-1" },
		});
		expect(fake.session.prompt).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			id: clientId,
			text: "hello",
		});
		expect(clientId).toMatch(/^msg_/);
		const [agentCall] = fake.session.switchAgent.mock.invocationCallOrder;
		const [modelCall] = fake.session.switchModel.mock.invocationCallOrder;
		const [promptCall] = fake.session.prompt.mock.invocationCallOrder;
		expect(agentCall!).toBeLessThan(modelCall!);
		expect(modelCall!).toBeLessThan(promptCall!);
	});

	it("only prompts when no agent or model is chosen", async () => {
		const { fake, controller } = setup();

		await controller.sendMessage(hello());

		expect(fake.session.switchAgent).not.toHaveBeenCalled();
		expect(fake.session.switchModel).not.toHaveBeenCalled();
		expect(fake.session.prompt).toHaveBeenCalledOnce();
	});

	it("sends an attachment with the name and content type its parts don't carry", async () => {
		const { fake, controller } = setup();

		await controller.sendMessage(
			appendMessage(
				[],
				[
					{
						id: "a-1",
						type: "image",
						name: "photo.webp",
						contentType: "image/webp",
						status: { type: "complete" },
						content: [{ type: "image", image: "QUJD" }],
					},
				],
			),
		);

		expect(fake.session.prompt.mock.calls[0]?.[0]).toMatchObject({
			files: [{ uri: "data:image/webp;base64,QUJD", name: "photo.webp" }],
		});
	});

	it("sends through the host's prompt sender when it has one", async () => {
		const fake = createFakeClient();
		const sendPrompt = vi.fn(async () => undefined);
		const controller = new OpenCodeThreadController(
			fake.client,
			() => createFakeEventSource(),
			SESSION_ID,
			sendPrompt,
		);

		await controller.sendMessage(hello(), { agent: "code" });

		const [clientId] = Object.keys(controller.getState().pendingUserMessages);
		expect(sendPrompt).toHaveBeenCalledWith({
			sessionId: SESSION_ID,
			messageId: clientId,
			parts: [{ type: "text", text: "hello" }],
			options: { agent: "code" },
		});
		expect(fake.session.prompt).not.toHaveBeenCalled();
	});

	it("shows the prompt as pending and running until the server admits it", async () => {
		const { events, controller } = setup();
		controller.subscribe(() => undefined);

		await controller.sendMessage(hello());
		const [clientId] = Object.keys(controller.getState().pendingUserMessages);
		expect(controller.getState().runState).toEqual({ type: "streaming" });

		events.emit(
			serverEvent("session.inbox.enqueued", {
				inboxID: clientId,
				item: { type: "user", payload: { text: "hello" }, delivery: "queue" },
			}),
		);

		expect(controller.getState().pendingUserMessages).toEqual({});
		expect(ids(controller.getState())).toEqual([clientId]);
	});

	it("stages a message locally and sends it later, once", async () => {
		const { fake, controller } = setup();

		await controller.stageMessage(hello(), { agent: "plan" });
		const [clientId] = Object.keys(controller.getState().pendingUserMessages);
		expect(fake.session.prompt).not.toHaveBeenCalled();

		await expect(controller.sendStagedMessage(`local:${clientId}`)).resolves.toBe(true);
		expect(fake.session.switchAgent).toHaveBeenCalledWith({ sessionID: SESSION_ID, agent: "plan" });
		expect(fake.session.prompt).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			id: clientId,
			text: "hello",
		});
		await expect(controller.sendStagedMessage(`local:${clientId}`)).resolves.toBe(false);
	});

	it("resets a failed staged message when retrying", async () => {
		const { fake, controller } = setup();
		const retry = createDeferred<never>();
		fake.session.prompt.mockRejectedValueOnce(new Error("boom")).mockReturnValueOnce(retry.promise);

		await controller.stageMessage(hello());
		const [clientId] = Object.keys(controller.getState().pendingUserMessages);
		await expect(controller.sendStagedMessage(`local:${clientId}`)).rejects.toThrow("boom");
		expect(controller.getState().pendingUserMessages[clientId!]).toMatchObject({
			status: "failed",
			error: expect.any(Error),
		});

		const retrying = controller.sendStagedMessage(`local:${clientId}`);
		expect(controller.getState().pendingUserMessages[clientId!]).toMatchObject({
			status: "pending",
		});
		expect(controller.getState().pendingUserMessages[clientId!]?.error).toBeUndefined();

		retry.resolve(undefined as never);
		await expect(retrying).resolves.toBe(true);
	});

	it("marks a message failed when the server rejects the prompt", async () => {
		const { fake, controller } = setup();
		const error = new Error("Unauthorized");
		fake.session.prompt.mockRejectedValueOnce(error);

		await expect(controller.sendMessage(hello())).rejects.toBe(error);

		expect(Object.values(controller.getState().pendingUserMessages)[0]).toMatchObject({
			status: "failed",
			error,
		});
		expect(controller.getState().runState).toEqual({ type: "error", error });
	});

	it("refuses to send anything but a user message", async () => {
		const { controller } = setup();

		await expect(
			controller.sendMessage({ ...hello(), role: "assistant" } as AppendMessage),
		).rejects.toThrow();
	});

	it("isolates subscriber errors while sending messages", async () => {
		const { fake, controller } = setup();
		const listenerError = new Error("listener failed");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		onTestFinished(() => consoleError.mockRestore());
		const laterListener = vi.fn();
		controller.subscribe(() => {
			throw listenerError;
		});
		controller.subscribe(laterListener);

		await expect(controller.sendMessage(hello())).resolves.toBeUndefined();

		expect(fake.session.prompt).toHaveBeenCalledOnce();
		expect(laterListener).toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(
			"[react-opencode] Listener threw an error",
			listenerError,
		);
	});
});

describe("OpenCodeThreadController: event subscription", () => {
	it("re-subscribes through the provider after dispose", async () => {
		const fake = createFakeClient();
		let events = createFakeEventSource();
		const getEventSource = vi.fn(() => events);
		const controller = new OpenCodeThreadController(fake.client, getEventSource, SESSION_ID);
		await controller.load();

		controller.subscribe(vi.fn());
		expect(events.subscribe).toHaveBeenCalledOnce();

		controller.dispose();
		expect(events.unsubscribe).toHaveBeenCalledOnce();

		events = createFakeEventSource();
		const listener = vi.fn();
		controller.subscribe(listener);
		events.emit(serverEvent("session.renamed", { title: "Recovered session" }));

		expect(getEventSource).toHaveBeenCalledTimes(2);
		expect(events.subscribe).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalled();
		expect(controller.getState().session?.title).toBe("Recovered session");
	});

	it("detaches from events when the last state listener unsubscribes", async () => {
		const { events, controller } = setup();
		await controller.load();
		const unsubscribeFirst = controller.subscribe(vi.fn());
		const second = vi.fn();
		const unsubscribeSecond = controller.subscribe(second);
		expect(events.subscribe).toHaveBeenCalledOnce();

		unsubscribeFirst();
		expect(controller.isAttachedToEvents()).toBe(true);
		events.emit(serverEvent("session.renamed", { title: "Still attached" }));
		expect(second).toHaveBeenCalled();

		unsubscribeSecond();
		expect(controller.isAttachedToEvents()).toBe(false);
		expect(events.unsubscribe).toHaveBeenCalledOnce();
	});

	it("supports detached subscribe and getState references", () => {
		const { events, controller } = setup();
		const { subscribe, getState } = controller;

		const unsubscribe = subscribe(vi.fn());
		expect(events.subscribe).toHaveBeenCalledOnce();
		expect(getState().sessionId).toBe(SESSION_ID);

		unsubscribe();
		expect(events.unsubscribe).toHaveBeenCalledOnce();
	});

	it("ignores other sessions' events", async () => {
		const { events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		const before = controller.getState();

		events.emit(serverEvent("session.renamed", { sessionID: "ses_other", title: "Other" }));

		expect(controller.getState()).toBe(before);
	});
});

describe("OpenCodeThreadController: history", () => {
	it("opens with the newest page and loads older pages in the background", async () => {
		const { fake, controller } = setup();
		const transcript = messageIds(300);
		fake.transcripts.set(SESSION_ID, transcript);

		await controller.load();

		expect(fake.message.list).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			limit: OPEN_CODE_HISTORY_PAGE_SIZE,
		});
		expect(ids(controller.getState())).toEqual(transcript.slice(-50).map((message) => message.id));
		expect(controller.getState().olderHistory).toEqual({ type: "available", cursor: "250" });

		await vi.waitFor(() =>
			expect(controller.getState().olderHistory).toEqual({ type: "complete" }),
		);
		expect(ids(controller.getState())).toEqual(transcript.map((message) => message.id));
		expect(fake.message.list.mock.calls.slice(1).map(([input]) => input)).toEqual([
			{ sessionID: SESSION_ID, cursor: "250", limit: 200 },
			{ sessionID: SESSION_ID, cursor: "50", limit: 200 },
		]);
	});

	it("is complete when the newest page holds the whole session", async () => {
		const { fake, controller } = setup();
		fake.transcripts.set(SESSION_ID, messageIds(12));

		await controller.load();

		expect(controller.getState().olderHistory).toEqual({ type: "complete" });
		expect(controller.getState().messages).toHaveLength(12);
		expect(fake.message.list).toHaveBeenCalledOnce();
	});

	it("loads everything first when a staged revert's boundary lies beyond the newest page", async () => {
		const { fake, controller } = setup();
		const transcript = messageIds(300);
		fake.transcripts.set(SESSION_ID, transcript);
		fake.sessions.set(
			SESSION_ID,
			session(SESSION_ID, { revert: { messageID: transcript[10]!.id } }),
		);
		const loadedSizes: number[] = [];
		controller.subscribe(() => {
			const state = controller.getState();
			if (state.loadState.type === "ready") loadedSizes.push(state.messages.length);
		});

		await controller.load();

		expect(loadedSizes[0]).toBe(300);
		expect(controller.getState().olderHistory).toEqual({ type: "complete" });
		expect(fake.message.list).toHaveBeenCalledTimes(3);
	});

	it("opens with the newest page when a staged revert's boundary lies inside it", async () => {
		const { fake, controller } = setup();
		const transcript = messageIds(300);
		fake.transcripts.set(SESSION_ID, transcript);
		fake.sessions.set(
			SESSION_ID,
			session(SESSION_ID, { revert: { messageID: transcript[290]!.id } }),
		);

		await controller.load();

		expect(controller.getState().messages).toHaveLength(50);
		expect(fake.message.list).toHaveBeenCalledOnce();
	});

	it("records a failed older page, keeping the newest one", async () => {
		const { fake, controller } = setup();
		fake.transcripts.set(SESSION_ID, messageIds(80));
		const error = new Error("offline");
		await controller.load();
		fake.message.list.mockRejectedValueOnce(error);

		await vi.waitFor(() =>
			expect(controller.getState().olderHistory).toEqual({ type: "failed", cursor: "30", error }),
		);
		expect(controller.getState().messages).toHaveLength(50);
	});

	it("records a failed load and rejects", async () => {
		const { fake, controller } = setup();
		const error = new Error("Session not found");
		fake.session.get.mockRejectedValueOnce(error);

		await expect(controller.load()).rejects.toBe(error);
		expect(controller.getState().loadState).toEqual({ type: "error", error });
	});

	it("keeps forced reloads authoritative while earlier loads finish", async () => {
		const { fake, controller } = setup();
		const firstSession = createDeferred<SessionInfo>();
		const firstPage = createDeferred<SessionMessagesResponse>();
		const secondSession = createDeferred<SessionInfo>();
		const secondPage = createDeferred<SessionMessagesResponse>();
		fake.session.get
			.mockReturnValueOnce(firstSession.promise)
			.mockReturnValueOnce(secondSession.promise);
		fake.message.list
			.mockReturnValueOnce(firstPage.promise)
			.mockReturnValueOnce(secondPage.promise);

		const firstLoad = controller.load();
		const secondLoad = controller.load(true);
		firstSession.resolve(session(SESSION_ID, { title: "stale" }));
		firstPage.resolve({ data: [user("msg_stale")], cursor: {} });
		await firstLoad;
		expect(controller.getState().loadState.type).toBe("loading");

		const thirdLoad = controller.load();
		expect(fake.session.get).toHaveBeenCalledTimes(2);

		secondSession.resolve(session(SESSION_ID, { title: "fresh" }));
		secondPage.resolve({ data: [user("msg_fresh")], cursor: {} });
		await Promise.all([secondLoad, thirdLoad]);

		expect(controller.getState().loadState.type).toBe("ready");
		expect(controller.getState().session?.title).toBe("fresh");
		expect(ids(controller.getState())).toEqual(["msg_fresh"]);
	});

	it("reloads, rather than guessing, when an event arrives for a step it doesn't hold", async () => {
		const { fake, events, controller } = setup();
		fake.transcripts.set(SESSION_ID, [user("msg_1")]);
		await controller.load();
		controller.subscribe(vi.fn());
		fake.message.list.mockClear();

		events.emit(
			serverEvent("session.text.delta", {
				assistantMessageID: "msg_missed",
				ordinal: 0,
				delta: "x",
			}),
		);

		expect(ids(controller.getState())).toEqual(["msg_1"]);
		await vi.waitFor(() => expect(fake.message.list).toHaveBeenCalledOnce());
	});

	it("reloads once a compaction ends", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		fake.message.list.mockClear();

		events.emit(serverEvent("session.compaction.ended", { reason: "manual", text: "Summary" }));

		await vi.waitFor(() => expect(fake.message.list).toHaveBeenCalledOnce());
	});
});

describe("OpenCodeThreadController: running", () => {
	it("reads whether the session runs from session.active when it attaches", async () => {
		const { fake, controller } = setup();
		fake.session.active.mockResolvedValue({ [SESSION_ID]: { type: "running" } });

		controller.subscribe(vi.fn());

		await vi.waitFor(() =>
			expect(controller.getState()).toMatchObject({
				running: true,
				runState: { type: "streaming" },
			}),
		);
	});

	it("loads whether the session runs with its history", async () => {
		const { fake, controller } = setup();
		fake.session.active.mockResolvedValue({ [SESSION_ID]: { type: "running" } });

		await controller.load();

		expect(controller.getState().running).toBe(true);
	});

	it("follows the session's execution events", async () => {
		const { events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());

		events.emit(serverEvent("session.execution.started"));
		expect(controller.getState().running).toBe(true);

		events.emit(serverEvent("session.execution.succeeded"));
		expect(controller.getState()).toMatchObject({ running: false, runState: { type: "idle" } });
		expect(controller.getState().messages.at(-1)).toMatchObject({
			type: "idle",
			outcome: "succeeded",
		});
	});

	it("ignores a session.active reply older than a newer execution event", async () => {
		const { fake, events, controller } = setup();
		const reply = createDeferred<Awaited<ReturnType<FakeClient["client"]["session"]["active"]>>>();
		fake.session.active.mockReturnValueOnce(reply.promise);
		controller.subscribe(vi.fn());
		await vi.waitFor(() => expect(fake.session.active).toHaveBeenCalledOnce());

		events.emit(serverEvent("session.execution.started"));
		reply.resolve({});
		await settleMicrotasks();

		expect(controller.getState().running).toBe(true);
	});

	it("ignores a reload's session.active reply older than a newer execution event", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		await settleMicrotasks();
		const reply = createDeferred<Awaited<ReturnType<FakeClient["client"]["session"]["active"]>>>();
		fake.session.active.mockReturnValueOnce(reply.promise);

		const reload = controller.refresh();
		events.emit(serverEvent("session.execution.started"));
		reply.resolve({});
		await reload;

		expect(controller.getState().running).toBe(true);
	});

	it("reads whether the session runs again after a reconnect", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		events.emit(serverEvent("session.execution.started"));
		fake.session.active.mockResolvedValue({});

		events.emit(streamReconnected);

		await vi.waitFor(() =>
			expect(controller.getState()).toMatchObject({ running: false, runState: { type: "idle" } }),
		);
	});

	it("keeps a run the server still reports after a reconnect", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		fake.session.active.mockResolvedValue({ [SESSION_ID]: { type: "running" } });

		events.emit(streamReconnected);

		await vi.waitFor(() =>
			expect(controller.getState()).toMatchObject({
				running: true,
				runState: { type: "streaming" },
			}),
		);
	});

	it("keeps the current state when session.active fails", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		events.emit(serverEvent("session.execution.started"));
		fake.session.active.mockRejectedValue(new Error("404"));

		events.emit(streamReconnected);
		await vi.waitFor(() => expect(fake.session.get).toHaveBeenCalledTimes(2));
		await settleMicrotasks();

		expect(controller.getState().running).toBe(true);
	});
});

describe("OpenCodeThreadController: reconnect", () => {
	it("reloads history and reads interactions again when the stream reconnects", async () => {
		const { fake, events, controller } = setup();
		controller.subscribe(vi.fn());

		events.emit(streamReconnected);

		await vi.waitFor(() => {
			expect(fake.session.get).toHaveBeenCalledOnce();
			expect(fake.message.list).toHaveBeenCalledOnce();
			expect(fake.permission.list).toHaveBeenCalledWith({ sessionID: SESSION_ID });
			expect(fake.session.form.list).toHaveBeenCalledWith({ sessionID: SESSION_ID });
		});
	});

	it("re-surfaces pending permissions and question forms after a reconnect", async () => {
		const { fake, events, controller } = setup();
		controller.subscribe(vi.fn());
		fake.permission.list.mockResolvedValue([permissionRequest("per_1")]);
		fake.session.form.list.mockResolvedValue([
			questionForm("frm_1"),
			{ ...questionForm("frm_other"), metadata: { kind: "mcp" } },
		]);

		events.emit(streamReconnected);

		await vi.waitFor(() => {
			expect(Object.keys(controller.getState().interactions.permissions.pending)).toEqual([
				"per_1",
			]);
			expect(Object.keys(controller.getState().interactions.questions.pending)).toEqual(["frm_1"]);
		});
	});
});

describe("OpenCodeThreadController: interactions", () => {
	async function withQuestion(events: FakeEventSource, controller: OpenCodeThreadController) {
		await controller.load();
		controller.subscribe(vi.fn());
		events.emit(serverEvent("form.created", { form: questionForm("frm_1") }));
	}

	it("replies to a permission and records the decision", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		events.emit(serverEvent("permission.asked", { ...permissionRequest("per_1") }));

		await controller.replyToPermission("per_1", "always");

		expect(fake.permission.reply).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			requestID: "per_1",
			decision: "always",
		});
		expect(controller.getState().interactions.permissions.resolved.per_1?.reply).toBe("always");
	});

	it("replies to a question form with its answers by field and records them", async () => {
		const { fake, events, controller } = setup();
		await withQuestion(events, controller);

		await controller.replyToQuestion("frm_1", [["Yes"]]);

		expect(fake.session.form.reply).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			formID: "frm_1",
			answer: { q0: "Yes" },
		});
		expect(fake.session.form.get).not.toHaveBeenCalled();
		expect(controller.getState().interactions.questions.answered.frm_1?.answers).toEqual([["Yes"]]);
		expect(controller.getState().interactions.questions.pending).toEqual({});
	});

	it("reads a form it doesn't hold before replying to it", async () => {
		const { fake, controller } = setup();
		fake.session.form.get.mockResolvedValue({
			...questionForm("frm_9"),
			state: { status: "pending" } as never,
		});

		await controller.replyToQuestion("frm_9", [["No"]]);

		expect(fake.session.form.get).toHaveBeenCalledWith({ sessionID: SESSION_ID, formID: "frm_9" });
		expect(fake.session.form.reply).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			formID: "frm_9",
			answer: { q0: "No" },
		});
	});

	it("rejects a question form by cancelling it", async () => {
		const { fake, events, controller } = setup();
		await withQuestion(events, controller);

		await controller.rejectQuestion("frm_1");

		expect(fake.session.form.cancel).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			formID: "frm_1",
		});
		expect(controller.getState().interactions.questions.rejected.frm_1).toBeDefined();
		expect(controller.getState().interactions.questions.pending).toEqual({});
	});

	it("forks before a message and returns the fork's id", async () => {
		const { fake, controller } = setup();

		await expect(controller.fork("msg_3")).resolves.toBe(`${SESSION_ID}_fork`);
		expect(fake.session.fork).toHaveBeenCalledWith({ sessionID: SESSION_ID, before: "msg_3" });
	});
});

describe("OpenCodeThreadController: cancel", () => {
	it("is cancelling until the server reports the run interrupted", async () => {
		const { fake, events, controller } = setup();
		await controller.load();
		controller.subscribe(vi.fn());
		events.emit(serverEvent("session.execution.started"));

		await controller.cancel();
		expect(fake.session.interrupt).toHaveBeenCalledWith({ sessionID: SESSION_ID });
		expect(controller.getState().runState).toEqual({ type: "cancelling" });

		events.emit(serverEvent("session.execution.interrupted", { reason: "user" }));
		expect(controller.getState()).toMatchObject({ running: false, runState: { type: "idle" } });
	});

	it("goes idle when there was nothing to interrupt", async () => {
		const { fake, controller } = setup();
		fake.session.interrupt.mockResolvedValueOnce({ interrupted: false });

		await controller.cancel();

		expect(controller.getState()).toMatchObject({ running: false, runState: { type: "idle" } });
	});

	it("moves to the error state and rethrows when the interrupt fails", async () => {
		const { fake, controller } = setup();
		fake.session.interrupt.mockRejectedValueOnce(new Error("offline"));

		await expect(controller.cancel()).rejects.toThrow("offline");
		expect(controller.getState().runState.type).toBe("error");
	});
});

describe("OpenCodeThreadController: subagent sessions", () => {
	const transcriptsOf = (fake: FakeClient, transcripts: Record<string, Transcript>) => {
		for (const [sessionId, transcript] of Object.entries(transcripts))
			fake.transcripts.set(sessionId, transcript);
	};

	it("inspects only the changed message's tools when syncing child sessions", async () => {
		const { fake, events, controller } = setup();
		transcriptsOf(fake, {
			[SESSION_ID]: Array.from({ length: 40 }, (_, index) =>
				assistant(`msg_${index}`, [runningTool(`call_${index}`, "read")]),
			),
		});
		controller.subscribe(vi.fn());
		await controller.load();
		getOpenCodeTaskSessionIdSpy.mockClear();

		events.emit(
			serverEvent("session.tool.progress", {
				assistantMessageID: "msg_7",
				id: "call_7",
				metadata: { lines: 1 },
			}),
		);

		expect(getOpenCodeTaskSessionIdSpy).toHaveBeenCalledOnce();
	});

	it("defers child-session work until the parent has a listener", async () => {
		const { fake, events, controller } = setup("ses_parent");
		transcriptsOf(fake, { ses_parent: [withSubagents("msg_p", ["ses_child"])] });

		await controller.load();
		expect(fake.message.list).toHaveBeenCalledOnce();
		expect(events.subscribe).not.toHaveBeenCalled();
		expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("idle");

		const unsubscribe = controller.subscribe(vi.fn());
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);
		expect(fake.message.list).toHaveBeenCalledTimes(2);
		expect(events.subscribe).toHaveBeenCalledTimes(2);

		unsubscribe();
		expect(events.unsubscribe).toHaveBeenCalledTimes(2);
	});

	it("reads permissions and forms again for the root session only", async () => {
		const { fake, events, controller } = setup("ses_parent");
		transcriptsOf(fake, { ses_parent: [withSubagents("msg_p", ["ses_child"])] });
		controller.subscribe(vi.fn());
		await controller.load();
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);
		const listsBefore = fake.message.list.mock.calls.length;

		events.emit(streamReconnected);

		await vi.waitFor(() =>
			expect(fake.message.list.mock.calls.length).toBeGreaterThan(listsBefore + 1),
		);
		const sessionsAsked = (calls: readonly (readonly [{ sessionID: string }, ...unknown[]])[]) =>
			new Set(calls.map(([input]) => input.sessionID));
		expect(sessionsAsked(fake.permission.list.mock.calls)).toEqual(new Set(["ses_parent"]));
		expect(sessionsAsked(fake.session.form.list.mock.calls)).toEqual(new Set(["ses_parent"]));
		expect(fake.session.active.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("does not reload a loaded child when the parent re-attaches", async () => {
		const { fake, controller } = setup("ses_parent");
		transcriptsOf(fake, { ses_parent: [withSubagents("msg_p", ["ses_child"])] });
		await controller.load();
		const unsubscribe = controller.subscribe(vi.fn());
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);
		const listsAfterAttach = fake.message.list.mock.calls.length;

		unsubscribe();
		controller.subscribe(vi.fn());

		expect(fake.message.list).toHaveBeenCalledTimes(listsAfterAttach);
		expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready");
	});

	it("reports a child discovered on a live thread as loading before its history resolves", async () => {
		const { fake, events, controller } = setup("ses_parent");
		const childPage = createDeferred<SessionMessagesResponse>();
		fake.message.list.mockImplementation(async ({ sessionID }) =>
			sessionID === "ses_child" ? childPage.promise : { data: [], cursor: {} },
		);
		controller.subscribe(vi.fn());
		await controller.load();

		const onStep = (type: string, data: Record<string, unknown>) =>
			serverEvent(type, { sessionID: "ses_parent", assistantMessageID: "msg_p", ...data });
		events.emit(stepStarted("msg_p", "ses_parent"));
		events.emit(onStep("session.tool.input.started", { id: "call_1", name: "subagent" }));
		events.emit(onStep("session.tool.called", { id: "call_1", input: { agent: "explore" } }));
		events.emit(
			onStep("session.tool.progress", { id: "call_1", metadata: { sessionID: "ses_child" } }),
		);

		expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("loading");

		childPage.resolve({ data: [], cursor: {} });
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);
	});

	it("loads parallel and nested child sessions without following ancestor cycles", async () => {
		const { fake, events, controller } = setup("ses_parent");
		transcriptsOf(fake, {
			ses_parent: [withSubagents("msg_p", ["ses_child_a", "ses_child_b"])],
			ses_child_a: [withSubagents("msg_a", ["ses_grandchild"])],
			ses_grandchild: [withSubagents("msg_g", ["ses_parent"])],
		});
		const unsubscribe = controller.subscribe(vi.fn());

		await controller.load();

		await vi.waitFor(() =>
			expect(
				controller.getState().childSessionsById.ses_child_a?.childSessionsById.ses_grandchild
					?.loadState.type,
			).toBe("ready"),
		);
		expect(Object.keys(controller.getState().childSessionsById).sort()).toEqual([
			"ses_child_a",
			"ses_child_b",
		]);
		expect(new Set(fake.message.list.mock.calls.map(([input]) => input.sessionID))).toEqual(
			new Set(["ses_parent", "ses_child_a", "ses_child_b", "ses_grandchild"]),
		);
		expect(fake.message.list).toHaveBeenCalledTimes(4);
		expect(
			controller.getState().childSessionsById.ses_child_a?.childSessionsById.ses_grandchild
				?.childSessionsById,
		).toEqual({});
		expect(events.subscribe).toHaveBeenCalledTimes(4);

		unsubscribe();
		expect(events.unsubscribe).toHaveBeenCalledTimes(4);
	});

	it("routes a child session's live events into its nested state", async () => {
		const { fake, events, controller } = setup("ses_parent");
		transcriptsOf(fake, { ses_parent: [withSubagents("msg_p", ["ses_child"])] });
		const listener = vi.fn();
		controller.subscribe(listener);
		await controller.load();
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);
		listener.mockClear();

		events.emit(stepStarted("msg_child", "ses_child"));
		events.emit(
			serverEvent("session.text.started", {
				sessionID: "ses_child",
				assistantMessageID: "msg_child",
				ordinal: 0,
			}),
		);
		events.emit(
			serverEvent("session.text.delta", {
				sessionID: "ses_child",
				assistantMessageID: "msg_child",
				ordinal: 0,
				delta: "Live child output",
			}),
		);

		const child = controller.getState().childSessionsById.ses_child;
		expect(child?.messages.at(-1)).toMatchObject({
			id: "msg_child",
			content: [text("Live child output")],
		});
		expect(listener).toHaveBeenCalled();
	});

	it("lets go of a child session once its subagent call leaves the transcript", async () => {
		const { fake, events, controller } = setup("ses_parent");
		transcriptsOf(fake, { ses_parent: [user("msg_u"), withSubagents("msg_p", ["ses_child"])] });
		controller.subscribe(vi.fn());
		await controller.load();
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);
		expect(events.listeners.size).toBe(2);

		events.emit(serverEvent("session.revert.committed", { sessionID: "ses_parent", to: "msg_p" }));

		expect(controller.getState().childSessionsById).toEqual({});
		expect(events.listeners.size).toBe(1);
	});

	it("keeps a child session while another subagent call still runs in it", async () => {
		const { fake, events, controller } = setup("ses_parent");
		transcriptsOf(fake, {
			ses_parent: [withSubagents("msg_p1", ["ses_child"]), withSubagents("msg_p2", ["ses_child"])],
		});
		controller.subscribe(vi.fn());
		await controller.load();
		await vi.waitFor(() =>
			expect(controller.getState().childSessionsById.ses_child?.loadState.type).toBe("ready"),
		);

		events.emit(serverEvent("session.revert.committed", { sessionID: "ses_parent", to: "msg_p2" }));
		expect(controller.getState().childSessionsById.ses_child).toBeDefined();
		expect(events.listeners.size).toBe(2);

		events.emit(serverEvent("session.revert.committed", { sessionID: "ses_parent", to: "msg_p1" }));
		expect(controller.getState().childSessionsById).toEqual({});
		expect(events.listeners.size).toBe(1);
	});

	it("does not attach descendants from a removed child's history still on its way", async () => {
		const { fake, events, controller } = setup("ses_parent");
		const childPage = createDeferred<SessionMessagesResponse>();
		fake.message.list.mockImplementation(async ({ sessionID }) => {
			if (sessionID === "ses_parent")
				return { data: [withSubagents("msg_p", ["ses_child"])], cursor: {} };
			if (sessionID === "ses_child") return childPage.promise;
			return { data: [], cursor: {} };
		});
		controller.subscribe(vi.fn());
		await controller.load();
		await vi.waitFor(() => expect(fake.message.list).toHaveBeenCalledTimes(2));

		events.emit(serverEvent("session.revert.committed", { sessionID: "ses_parent", to: "msg_p" }));
		childPage.resolve({ data: [withSubagents("msg_c", ["ses_grandchild"])], cursor: {} });
		await settleMicrotasks();

		expect(fake.message.list).toHaveBeenCalledTimes(2);
		expect(events.listeners.size).toBe(1);
	});
});
