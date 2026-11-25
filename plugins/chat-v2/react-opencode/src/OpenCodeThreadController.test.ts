import type { AppendMessage } from "@assistant-ui/react";
import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";
import { describe, expect, it, vi } from "vitest";

import type { KiloClient } from "./kilo";
import { OpenCodeEventSource, STREAM_RECONNECTED_EVENT_TYPE } from "./OpenCodeEventSource";
import { OpenCodeThreadController } from "./OpenCodeThreadController";
import type { OpenCodeServerEvent } from "./types";
import turn from "./v2/fixtures/read-tool-turn.json";
import { projectOpenCodeThreadMessages } from "./openCodeMessageProjection";

const SESSION = turn.session as unknown as SessionInfo;
const EVENTS = turn.events as unknown as OpenCodeEvent[];

const PERMISSION = {
	id: "per_1",
	sessionID: SESSION.id,
	action: "shell",
	resources: ["ls"],
	save: ["ls *"],
	source: { type: "tool", messageID: "msg_a", id: "call_1" },
};
const FORM = {
	id: "frm_1",
	sessionID: SESSION.id,
	title: "Questions",
	fields: [{ key: "q0", type: "string", description: "Ship it?", options: [] }],
};

/** The `@kilocode/client` calls the controller makes, recorded, answering from the fixture. */
function fakeKilo(active: Record<string, unknown> = { [SESSION.id]: { type: "running" } }) {
	const calls: [string, unknown][] = [];
	const record =
		(name: string, answer: (input: never) => unknown = () => undefined) =>
		async (input?: unknown) => {
			calls.push([name, input]);
			return answer(input as never);
		};
	const client = {
		session: {
			get: record("session.get", () => SESSION),
			active: record("session.active", () => active),
			fork: record("session.fork", () => ({ ...SESSION, id: "ses_fork" })),
			switchAgent: record("session.switchAgent"),
			switchModel: record("session.switchModel"),
			prompt: record("session.prompt", () => ({ id: "msg_new" })),
			interrupt: record("session.interrupt"),
			revert: {
				stage: record("session.revert.stage"),
				clear: record("session.revert.clear"),
			},
			form: {
				list: record("session.form.list", () => [FORM]),
				reply: record("session.form.reply"),
				cancel: record("session.form.cancel"),
			},
		},
		message: {
			list: record("message.list", () => ({ data: turn.messages, cursor: {} })),
		},
		permission: {
			list: record("permission.list", () => [PERMISSION]),
			reply: record("permission.reply"),
		},
	};
	return { client: client as unknown as KiloClient, calls };
}

/** An event source the test drives. */
function manualEvents() {
	const listeners = new Set<(event: OpenCodeServerEvent) => void>();
	return {
		source: {
			subscribe(listener: (event: OpenCodeServerEvent) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		emit(type: string, properties: Record<string, unknown>, sessionId = SESSION.id) {
			for (const listener of listeners) listener({ type, sessionId, properties, raw: undefined });
		},
	};
}

const message = (content: AppendMessage["content"], attachments: unknown[] = []) =>
	({
		role: "user",
		content,
		parentId: null,
		sourceId: null,
		runConfig: undefined,
		attachments,
		createdAt: new Date(),
		metadata: { custom: {} },
	}) as unknown as AppendMessage;

describe("the thread controller on Kilo v2", () => {
	it("prompts after switching the session's agent and model", async () => {
		const { client, calls } = fakeKilo();
		const controller = new OpenCodeThreadController(client, () => manualEvents().source, "ses_1");

		await controller.sendMessage(
			message(
				[
					{ type: "text", text: "Fix it" },
					{ type: "image", image: "data:image/png;base64,AQID", filename: "a.png" } as never,
				],
				[],
			),
			{ agent: "plan", model: { providerID: "kilo", id: "fast", variant: "high" } },
		);
		await controller.sendMessage(message([{ type: "text", text: "Note" }]), { noReply: true });

		const prompts = calls.filter(([name]) => name === "session.prompt");
		// Each prompt goes out under a new Kilo message id, which its pending copy waits for.
		const sentIds = prompts.map(([, input]) => (input as { id: string }).id);
		expect(sentIds).toEqual([expect.stringMatching(/^msg_/), expect.stringMatching(/^msg_/)]);
		expect(sentIds[0]! < sentIds[1]!).toBe(true);
		expect(
			Object.values(controller.getState().pendingUserMessages).map((p) => p.messageId),
		).toEqual(sentIds);
		expect(calls.filter(([name]) => name !== "session.active")).toEqual([
			["session.switchAgent", { sessionID: "ses_1", agent: "plan" }],
			[
				"session.switchModel",
				{ sessionID: "ses_1", model: { providerID: "kilo", id: "fast", variant: "high" } },
			],
			[
				"session.prompt",
				{
					sessionID: "ses_1",
					id: sentIds[0],
					text: "Fix it",
					files: [{ uri: "data:image/png;base64,AQID", name: "a.png" }],
				},
			],
			["session.prompt", { sessionID: "ses_1", id: sentIds[1], text: "Note", resume: false }],
		]);
	});

	it("loads the session's whole history, adjusted as the backend asks", async () => {
		const { client, calls } = fakeKilo();
		const patchHistory = vi.fn((_: string, messages: readonly unknown[]) => messages.slice(1));
		const controller = new OpenCodeThreadController(
			client,
			() => manualEvents().source,
			SESSION.id,
			{ patchHistory: patchHistory as never },
		);

		await controller.load();

		const state = controller.getState();
		expect(calls).toContainEqual([
			"message.list",
			{ sessionID: SESSION.id, order: "asc", limit: 200 },
		]);
		expect(state.session).toEqual(SESSION);
		expect(patchHistory).toHaveBeenCalledWith(SESSION.id, expect.any(Array));
		const loaded = patchHistory.mock.calls[0]![1];
		expect(state.messageOrder).toHaveLength(loaded.length - 1);
		expect(state.olderHistory).toEqual({ type: "complete" });
	});

	it("reads whether its session is running, and stops, reverts, redoes and forks it", async () => {
		const { client, calls } = fakeKilo();
		const controller = new OpenCodeThreadController(
			client,
			() => manualEvents().source,
			SESSION.id,
		);
		const unsubscribe = controller.subscribe(() => undefined);
		await vi.waitFor(() => expect(controller.getState().sessionStatus).toEqual({ type: "busy" }));

		await controller.cancel();
		await controller.revert("msg_1");
		await controller.unrevert();
		await expect(controller.fork("msg_2")).resolves.toBe("ses_fork");

		expect(calls.filter(([name]) => name !== "session.get" && name !== "session.active")).toEqual([
			["session.interrupt", { sessionID: SESSION.id }],
			["session.revert.stage", { sessionID: SESSION.id, messageID: "msg_1" }],
			["session.revert.clear", { sessionID: SESSION.id }],
			["session.fork", { sessionID: SESSION.id, before: "msg_2" }],
		]);
		expect(controller.getState().runState).toEqual({ type: "idle" });
		unsubscribe();
	});

	it("reads its pending permissions and forms after a reconnect, and answers them", async () => {
		const { client, calls } = fakeKilo();
		const events = manualEvents();
		const controller = new OpenCodeThreadController(client, () => events.source, SESSION.id);
		const unsubscribe = controller.subscribe(() => undefined);

		events.emit(STREAM_RECONNECTED_EVENT_TYPE, {}, undefined as never);
		await vi.waitFor(() => {
			const { permissions, questions } = controller.getState().interactions;
			expect(Object.values(permissions.pending)).toEqual([expect.objectContaining(PERMISSION)]);
			expect(Object.values(questions.pending)).toEqual([expect.objectContaining(FORM)]);
		});
		await controller.replyToPermission("per_1", "always");
		await controller.replyToQuestion("frm_1", { q0: "Yes" });

		expect(calls).toContainEqual(["permission.list", { sessionID: SESSION.id }]);
		expect(calls).toContainEqual(["session.form.list", { sessionID: SESSION.id }]);
		expect(calls).toContainEqual([
			"permission.reply",
			{ sessionID: SESSION.id, requestID: "per_1", decision: "always" },
		]);
		expect(calls).toContainEqual([
			"session.form.reply",
			{ sessionID: SESSION.id, formID: "frm_1", answer: { q0: "Yes" } },
		]);
		expect(controller.getState().interactions.questions.answered.frm_1?.answer).toEqual({
			q0: "Yes",
		});
		unsubscribe();
	});

	it("follows Kilo v2's permission and form events", async () => {
		const { client, calls } = fakeKilo();
		const events = manualEvents();
		const controller = new OpenCodeThreadController(client, () => events.source, SESSION.id);
		const unsubscribe = controller.subscribe(() => undefined);
		const interactions = () => controller.getState().interactions;

		events.emit("permission.asked", PERMISSION);
		events.emit("form.created", { form: FORM });
		events.emit("form.created", { form: { ...FORM, id: "frm_2" } });
		expect(interactions().permissions.pending.per_1).toMatchObject({ action: "shell" });
		expect(Object.keys(interactions().questions.pending)).toEqual(["frm_1", "frm_2"]);

		events.emit("permission.replied", { sessionID: SESSION.id, requestID: "per_1", reply: "once" });
		events.emit("form.replied", { sessionID: SESSION.id, id: "frm_1", answer: { q0: "No" } });
		events.emit("form.cancelled", { sessionID: SESSION.id, id: "frm_2" });
		await controller.rejectQuestion("frm_3");

		expect(interactions().permissions.resolved.per_1?.reply).toBe("once");
		expect(interactions().questions.answered.frm_1?.answer).toEqual({ q0: "No" });
		expect(Object.keys(interactions().questions.rejected)).toEqual(["frm_2"]);
		expect(interactions().questions.pending).toEqual({});
		expect(calls).toContainEqual([
			"session.form.cancel",
			{ sessionID: SESSION.id, formID: "frm_3" },
		]);
		unsubscribe();
	});

	it("streams a recorded turn into the transcript its history loads as", async () => {
		const { client } = fakeKilo({});
		const live = new OpenCodeEventSource(async () => ({
			stream: (async function* () {
				for (const event of EVENTS) yield event;
			})(),
		}));
		const streamed = new OpenCodeThreadController(client, () => live, SESSION.id);
		const unsubscribe = streamed.subscribe(() => undefined);
		await vi.waitFor(() => expect(streamed.getState().sessionStatus).toEqual({ type: "idle" }));

		const loaded = new OpenCodeThreadController(
			client,
			() => ({ subscribe: () => () => undefined }),
			SESSION.id,
		);
		await loaded.load();

		const view = (controller: OpenCodeThreadController) =>
			projectOpenCodeThreadMessages(controller.getState()).map(({ id, role, content }) => ({
				id,
				role,
				content,
			}));
		expect(view(streamed)).toEqual(view(loaded));
		expect(view(loaded).map((message) => message.role)).toEqual(["user", "assistant"]);
		unsubscribe();
		live.dispose();
	});
});
