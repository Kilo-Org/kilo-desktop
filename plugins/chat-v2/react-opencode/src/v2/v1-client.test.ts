import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";
import { describe, expect, it, vi } from "vitest";

import { OpenCodeEventSource } from "../OpenCodeEventSource";
import { OpenCodeThreadController } from "../OpenCodeThreadController";
import turn from "./fixtures/read-tool-turn.json";
import { createV1Client, systemNote } from "./v1-client";
import { createV2EventSubscriber } from "./v2-event-source";

const SESSION = turn.session as unknown as SessionInfo;
const EVENTS = turn.events as unknown as OpenCodeEvent[];
const DIRECTORY = SESSION.location.directory;

/** The `@kilocode/client` calls the v1 client makes, recorded, answering from the fixture. */
function fakeV2(overrides: Record<string, unknown> = {}) {
	const calls: [string, unknown][] = [];
	const record =
		(name: string, answer: (input: never) => unknown = () => undefined) =>
		async (input: unknown) => {
			calls.push([name, input]);
			return answer(input as never);
		};
	const client = {
		session: {
			get: record("session.get", () => SESSION),
			create: record("session.create", () => SESSION),
			update: record("session.update"),
			remove: record("session.remove"),
			fork: record("session.fork", () => ({ ...SESSION, id: "ses_fork" })),
			active: record("session.active", () => ({ ses_busy: {} })),
			switchAgent: record("session.switchAgent"),
			switchModel: record("session.switchModel"),
			synthetic: record("session.synthetic"),
			prompt: record("session.prompt", () => ({ id: "msg_new" })),
			command: record("session.command"),
			interrupt: record("session.interrupt"),
			revert: {
				stage: record("session.revert.stage"),
				clear: record("session.revert.clear"),
			},
			form: {
				get: record("session.form.get", () => ({
					id: "frm_1",
					sessionID: "ses_turn",
					title: "Q",
					fields: [
						{ key: "q0", type: "string", options: [] },
						{ key: "q1", type: "multiselect", options: [] },
					],
				})),
				reply: record("session.form.reply"),
				cancel: record("session.form.cancel"),
			},
			list: record("session.list", () => ({ data: [SESSION], cursor: {} })),
		},
		message: {
			list: record("message.list", () => ({ data: turn.messages, cursor: {} })),
		},
		permission: {
			request: {
				list: record("permission.request.list", () => ({
					data: [{ id: "per_1", sessionID: "ses_turn", action: "shell", resources: ["ls"] }],
				})),
			},
			reply: record("permission.reply"),
		},
		form: {
			list: record("form.list", () => ({
				data: [{ id: "frm_1", sessionID: "ses_turn", title: "Q", fields: [] }],
			})),
		},
		event: {
			subscribe: async function* () {
				for (const event of EVENTS) yield event;
			},
		},
		...overrides,
	};
	return { client: client as never, calls };
}

describe("createV1Client", () => {
	it("prompts after switching agent and model, with system text and synthetic parts as hidden notes", async () => {
		const { client, calls } = fakeV2();
		const v1 = createV1Client(client, { directory: DIRECTORY });

		await v1.session.promptAsync({
			sessionID: "ses_turn",
			agent: "plan",
			model: { providerID: "kilo", modelID: "fast" },
			variant: "high",
			system: "Be brief",
			parts: [
				{ type: "text", text: "Fix it" },
				{ type: "text", text: "context", synthetic: true },
				{ type: "file", url: "file:///p/a.png", filename: "a.png", mime: "image/png" },
			],
		} as never);

		expect(calls).toEqual([
			["session.switchAgent", { sessionID: "ses_turn", agent: "plan" }],
			[
				"session.switchModel",
				{ sessionID: "ses_turn", model: { providerID: "kilo", id: "fast", variant: "high" } },
			],
			["session.synthetic", { sessionID: "ses_turn", text: systemNote("Be brief"), resume: false }],
			["session.synthetic", { sessionID: "ses_turn", text: "context", resume: false }],
			[
				"session.prompt",
				{
					sessionID: "ses_turn",
					text: "Fix it",
					files: [{ uri: "file:///p/a.png", name: "a.png" }],
				},
			],
		]);
	});

	it("sends without a turn for noReply, and runs commands with a provider/model string", async () => {
		const { client, calls } = fakeV2();
		const v1 = createV1Client(client);

		await v1.session.prompt({
			sessionID: "s",
			noReply: true,
			parts: [{ type: "text", text: "x" }],
		} as never);
		await v1.session.command({
			sessionID: "s",
			command: "init",
			arguments: "now",
			model: "kilo/fast",
		} as never);

		expect(calls).toEqual([
			["session.prompt", { sessionID: "s", text: "x", resume: false }],
			["session.switchModel", { sessionID: "s", model: { providerID: "kilo", id: "fast" } }],
			["session.command", { sessionID: "s", name: "init", text: "now" }],
		]);
	});

	it("loads the whole history as v1 messages, and nothing before it", async () => {
		const { client } = fakeV2();
		const v1 = createV1Client(client, { directory: DIRECTORY });

		const { data } = await v1.session.messages({ sessionID: "ses_turn", limit: 50 });
		const older = await v1.session.messages({
			sessionID: "ses_turn",
			limit: 50,
			before: "c",
		} as never);

		expect(data?.map((message) => message.info.role)).toEqual([
			"user",
			"user",
			"assistant",
			"assistant",
		]);
		expect(older.data).toEqual([]);
	});

	it("reports running sessions as busy, and maps stop, revert, redo and fork", async () => {
		const { client, calls } = fakeV2();
		const v1 = createV1Client(client);

		await expect(v1.session.status()).resolves.toEqual({ data: { ses_busy: { type: "busy" } } });
		await v1.session.abort({ sessionID: "s" });
		await v1.session.revert({ sessionID: "s", messageID: "msg_1" });
		await v1.session.unrevert({ sessionID: "s" });
		const fork = await v1.session.fork({ sessionID: "s", messageID: "msg_2" });

		expect(fork.data).toMatchObject({ id: "ses_fork", directory: DIRECTORY });
		expect(calls.filter(([name]) => name !== "session.get" && name !== "session.active")).toEqual([
			["session.interrupt", { sessionID: "s" }],
			["session.revert.stage", { sessionID: "s", messageID: "msg_1" }],
			["session.revert.clear", { sessionID: "s" }],
			["session.fork", { sessionID: "s", before: "msg_2" }],
		]);
	});

	it("lists and answers the directory's permissions and questions in v1 shapes", async () => {
		const { client, calls } = fakeV2();
		const v1 = createV1Client(client, { directory: "/p" });

		const permissions = await v1.permission.list();
		const questions = await v1.question.list();
		await v1.permission.reply({ requestID: "per_1", reply: "always" });
		await v1.question.reply({
			sessionID: "ses_turn",
			requestID: "frm_1",
			answers: [["A"], ["B", "C"]],
		} as never);
		await v1.question.reject({ requestID: "frm_1" });

		expect(permissions.data).toEqual([
			expect.objectContaining({
				id: "per_1",
				sessionID: "ses_turn",
				permission: "bash",
				patterns: ["ls"],
			}),
		]);
		expect(questions.data).toEqual([expect.objectContaining({ id: "frm_1", questions: [] })]);
		expect(calls).toContainEqual([
			"permission.reply",
			{ sessionID: "ses_turn", requestID: "per_1", decision: "always" },
		]);
		expect(calls).toContainEqual([
			"session.form.reply",
			{ sessionID: "ses_turn", formID: "frm_1", answer: { q0: "A", q1: ["B", "C"] } },
		]);
		expect(calls).toContainEqual([
			"session.form.cancel",
			{ sessionID: "ses_turn", formID: "frm_1" },
		]);
	});

	it("has no pending prompts without a directory, and refuses a reply it can't place", async () => {
		const { client } = fakeV2();
		const v1 = createV1Client(client);

		await expect(v1.permission.list()).resolves.toEqual({ data: [] });
		await expect(v1.permission.reply({ requestID: "per_x", reply: "once" })).rejects.toThrow(
			"needs the session of request per_x",
		);
		expect(() => v1.file.read({ path: "a" } as never)).toThrow("isn't on Kilo v2 yet");
	});
});

describe("the thread controller on Kilo v2", () => {
	it("streams a recorded turn into the transcript its history loads as", async () => {
		const { client } = fakeV2();
		const v1 = createV1Client(client, { directory: DIRECTORY });
		const live = new OpenCodeEventSource(
			v1,
			createV2EventSubscriber(
				(signal) =>
					(
						client as { event: { subscribe(o: unknown): AsyncIterable<OpenCodeEvent> } }
					).event.subscribe({ signal }),
				async () => SESSION,
			),
		);
		const streamed = new OpenCodeThreadController(v1, () => live, SESSION.id);
		const listener = vi.fn();
		const unsubscribe = streamed.subscribe(listener);
		await vi.waitFor(() => expect(streamed.getState().sessionStatus).toEqual({ type: "idle" }));

		const loaded = new OpenCodeThreadController(
			v1,
			() => ({ subscribe: () => () => undefined }),
			SESSION.id,
		);
		await loaded.load();

		const view = (controller: OpenCodeThreadController) => {
			const state = controller.getState();
			return state.messageOrder.map((id) =>
				state.messagesById[id]!.parts.map((part) => [
					part.id,
					part.type,
					"text" in part ? part.text : undefined,
				]),
			);
		};
		expect(view(streamed).filter((parts) => parts.length > 0)).toEqual(
			view(loaded).filter((parts) => parts.length > 0),
		);
		unsubscribe();
		live.dispose();
	});
});
