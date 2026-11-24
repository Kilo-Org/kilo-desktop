import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import { createOpenCodeThreadState, reduceOpenCodeThreadState } from "../openCodeThreadState";
import { projectOpenCodeThreadMessages } from "../openCodeMessageProjection";
import type { OpenCodeStateEvent, OpenCodeThreadState, Part } from "../types";
import turn from "./fixtures/read-tool-turn.json";
import { createV2EventSubscriber } from "./v2-event-source";
import { formAnswers, V2EventTranslator, type V1Event } from "./v2-events";
import { toV1Messages, type V2Message } from "./v2-messages";

/**
 * `read-tool-turn.json` is one real kilo2 turn (`kilo2 0.0.0-v2-239`, a
 * stand-in model): a hidden note, a prompt, an assistant step that says
 * "Let me look." and reads a file, and a second step that answers. It holds
 * the session, every event of the turn and the transcript afterwards.
 */
const SESSION = turn.session as unknown as SessionInfo;
const EVENTS = turn.events as unknown as OpenCodeEvent[];
const MESSAGES = turn.messages as unknown as V2Message[];
const DIRECTORY = SESSION.location.directory;

/** What the thread controller does with each v1 event it handles. */
function toStateEvents(event: V1Event): OpenCodeStateEvent[] {
	const p = event.properties;
	switch (event.type) {
		case "message.updated":
			return [{ type: "message.updated", info: p.info as never }];
		case "message.part.updated": {
			const part = p.part as Part;
			return [{ type: "part.updated", messageId: part.messageID, part }];
		}
		case "message.part.delta":
			return [
				{
					type: "part.delta",
					messageId: p.messageID as string,
					partId: p.partID as string,
					field: p.field as string,
					delta: p.delta as string,
				},
			];
		case "session.status":
			return [{ type: "session.status", status: p.status as never }];
		case "session.idle":
			return [{ type: "session.idle", sessionId: p.sessionID as string }];
		case "session.error":
			return [{ type: "run.failed", error: p.error }];
		default:
			return [];
	}
}

async function replay(events: readonly OpenCodeEvent[]) {
	const translator = new V2EventTranslator({ readSession: async () => SESSION });
	const translated: V1Event[] = [];
	for (const event of events) translated.push(...(await translator.translate(event)));
	let state = createOpenCodeThreadState(SESSION.id);
	for (const event of translated) {
		for (const stateEvent of toStateEvents(event))
			state = reduceOpenCodeThreadState(state, stateEvent);
	}
	return { translated, state };
}

function fromHistory(): OpenCodeThreadState {
	return reduceOpenCodeThreadState(createOpenCodeThreadState(SESSION.id), {
		type: "history.loaded",
		session: null,
		messages: toV1Messages(SESSION.id, DIRECTORY, MESSAGES),
	});
}

const transcript = (state: OpenCodeThreadState) =>
	state.messageOrder.map((id) => {
		const message = state.messagesById[id]!;
		return {
			id,
			role: message.info?.role,
			parts: message.parts.map((part) => {
				if (part.type === "text") return { id: part.id, type: part.type, text: part.text };
				if (part.type === "tool") {
					const { state: tool } = part;
					return {
						id: part.id,
						type: part.type,
						tool: part.tool,
						status: tool.status,
						input: tool.input,
						output: tool.status === "completed" ? tool.output : undefined,
					};
				}
				return { id: part.id, type: part.type };
			}),
		};
	});

describe("a real kilo2 turn", () => {
	it("streams into the same transcript its history loads as", async () => {
		const { state } = await replay(EVENTS);

		expect(transcript(state)).toEqual(transcript(fromHistory()));
	});

	it("reads as v1 messages: the note and prompt as user text, each step as an assistant reply", () => {
		const view = transcript(fromHistory());

		expect(view.map(({ role }) => role)).toEqual(["user", "user", "assistant", "assistant"]);
		expect(view[1]!.parts).toEqual([
			expect.objectContaining({ type: "text", text: "What do my notes say?" }),
		]);
		expect(view[2]!.parts).toEqual([
			expect.objectContaining({ type: "step-start" }),
			expect.objectContaining({ type: "text", text: "Let me look." }),
			expect.objectContaining({
				type: "tool",
				tool: "read",
				status: "completed",
				input: { path: expect.stringContaining("notes.txt") },
				output: expect.stringContaining("hello from notes"),
			}),
			expect.objectContaining({ type: "step-finish" }),
		]);
		expect(view[3]!.parts).toContainEqual(expect.objectContaining({ text: "It says hello." }));
	});

	it("marks the hidden note synthetic, so the transcript hides it, and links replies to the prompt", () => {
		const messages = toV1Messages(SESSION.id, DIRECTORY, MESSAGES);
		expect(messages[0]!.parts[0]).toMatchObject({ type: "text", synthetic: true });
		const prompt = messages[1]!.info.id;
		for (const reply of messages.slice(2)) expect(reply.info).toMatchObject({ parentID: prompt });

		// The two steps merge into one reply; the note is not shown.
		const projected = projectOpenCodeThreadMessages(fromHistory());
		expect(projected.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("runs busy while the turn executes and idle after it", async () => {
		const { translated, state } = await replay(EVENTS);
		const statuses = translated
			.filter((event) => event.type === "session.status")
			.map((event) => (event.properties.status as { type: string }).type);

		expect(statuses).toEqual(["busy", "idle"]);
		expect(state.runState).toEqual({ type: "idle" });
	});

	it("streams text as deltas on a part announced first", async () => {
		const { translated } = await replay(EVENTS);
		const first = translated.findIndex((event) => event.type === "message.part.delta");
		const partID = translated[first]!.properties.partID;

		expect(
			translated
				.slice(0, first)
				.some(
					(event) =>
						event.type === "message.part.updated" && (event.properties.part as Part).id === partID,
				),
		).toBe(true);
	});
});

const event = (type: string, data: Record<string, unknown>): OpenCodeEvent =>
	({ id: "e", created: 10, type, data, location: { directory: "/p" } }) as unknown as OpenCodeEvent;

async function translate(...events: OpenCodeEvent[]) {
	const translator = new V2EventTranslator();
	const out: V1Event[] = [];
	for (const item of events) out.push(...(await translator.translate(item)));
	return out;
}

describe("V2EventTranslator", () => {
	it("ends a failed turn with v1's error, then idle", async () => {
		const out = await translate(
			event("session.execution.failed", {
				sessionID: "s",
				error: { type: "provider.auth", message: "No key" },
			}),
		);

		expect(out.map(({ type }) => type)).toEqual([
			"session.error",
			"session.status",
			"session.idle",
		]);
		expect(out[0]!.properties.error).toEqual({
			name: "provider.auth",
			data: { message: "No key" },
		});
	});

	it("reports a retry with its attempt, message and time", async () => {
		const [out] = await translate(
			event("session.retry.scheduled", {
				sessionID: "s",
				assistantMessageID: "m",
				attempt: 2,
				at: 99,
				error: { type: "rate", message: "Slow down" },
			}),
		);

		expect(out!.properties.status).toEqual({
			type: "retry",
			attempt: 2,
			message: "Slow down",
			next: 99,
		});
	});

	it("streams reasoning and a tool's input, progress and failure as whole parts", async () => {
		const step = { sessionID: "s", assistantMessageID: "m" };
		const out = await translate(
			event("session.step.started", {
				...step,
				agent: "code",
				model: { id: "x", providerID: "p" },
				started: 1,
			}),
			event("session.reasoning.started", { ...step, ordinal: 0 }),
			event("session.reasoning.delta", { ...step, ordinal: 0, delta: "Hmm" }),
			event("session.reasoning.ended", { ...step, ordinal: 0, text: "Hmm." }),
			event("session.tool.input.started", { ...step, id: "c1", name: "shell" }),
			event("session.tool.input.delta", { ...step, id: "c1", delta: '{"command"' }),
			event("session.tool.called", {
				...step,
				id: "c1",
				input: { command: "ls" },
				executed: false,
			}),
			event("session.tool.progress", { ...step, id: "c1", metadata: { output: "a" } }),
			event("session.tool.failed", {
				...step,
				id: "c1",
				error: { type: "tool.execution", message: "exit 1" },
				executed: false,
			}),
		);
		const parts = out
			.filter(({ type }) => type === "message.part.updated")
			.map(({ properties }) => properties.part as Part);

		expect(parts.filter((part) => part.type === "reasoning").at(-1)).toMatchObject({
			id: "m:reasoning:0",
			text: "Hmm.",
			time: { start: 10, end: 10 },
		});
		const tool = parts.filter((part) => part.type === "tool");
		expect(tool.map((part) => part.type === "tool" && part.state.status)).toEqual([
			"pending",
			"pending",
			"running",
			"running",
			"error",
		]);
		expect(tool[1]).toMatchObject({ state: { raw: '{"command"' } });
		expect(tool[3]).toMatchObject({
			state: { input: { command: "ls" }, metadata: { output: "a" } },
		});
		expect(tool[4]).toMatchObject({ id: "m:tool:c1", tool: "bash", state: { error: "exit 1" } });
	});

	it("turns permission requests and forms into v1 permissions and questions", async () => {
		const out = await translate(
			event("permission.asked", {
				id: "per_1",
				sessionID: "s",
				action: "shell",
				resources: ["ls"],
				save: ["ls *"],
				source: { type: "tool", messageID: "m", id: "c1" },
			}),
			event("permission.replied", { sessionID: "s", requestID: "per_1", reply: "always" }),
			{
				...event("form.created", {
					form: {
						id: "frm_1",
						sessionID: "s",
						title: "Questions",
						fields: [
							{
								key: "q0",
								type: "multiselect",
								title: "Pick",
								description: "Which ones?",
								options: [{ value: "A", label: "A", description: "first" }],
								custom: true,
							},
						],
					},
				}),
			} as OpenCodeEvent,
			event("form.replied", { id: "frm_1", sessionID: "s", answer: { q0: ["A"] } }),
			event("form.cancelled", { id: "frm_2", sessionID: "s" }),
		);

		expect(out.map(({ type }) => type)).toEqual([
			"permission.asked",
			"permission.replied",
			"question.asked",
			"question.replied",
			"question.rejected",
		]);
		expect(out[0]!.properties).toEqual({
			id: "per_1",
			sessionID: "s",
			permission: "bash",
			patterns: ["ls"],
			metadata: {},
			always: ["ls *"],
			tool: { messageID: "m", callID: "c1" },
		});
		expect(out[2]!.properties).toEqual({
			id: "frm_1",
			sessionID: "s",
			questions: [
				{
					question: "Which ones?",
					header: "Pick",
					options: [{ label: "A", description: "first" }],
					multiple: true,
					custom: true,
				},
			],
		});
		expect(out[3]!.properties).toMatchObject({ requestID: "frm_1", answers: [["A"]] });
	});

	it("announces a session's changes with the session read again", async () => {
		const translator = new V2EventTranslator({ readSession: async () => SESSION });

		const [created] = await translator.translate(
			event("session.created", { sessionID: SESSION.id }),
		);
		const [renamed] = await translator.translate(
			event("session.renamed", { sessionID: SESSION.id }),
		);

		expect(created).toMatchObject({
			type: "session.created",
			properties: { info: { id: SESSION.id, directory: DIRECTORY } },
		});
		expect(renamed?.type).toBe("session.updated");
		await expect(
			new V2EventTranslator().translate(event("session.renamed", { sessionID: "x" })),
		).resolves.toEqual([]);
	});
});

describe("shell runs, skills and compactions", () => {
	const ev = (
		id: string,
		type: string,
		data: Record<string, unknown>,
		created: number,
	): OpenCodeEvent =>
		({ id, created, type, data, location: { directory: "/p" } }) as unknown as OpenCodeEvent;

	const shellInfo = (status: string, extra: Record<string, unknown> = {}) => ({
		id: "sh_1",
		status,
		command: "ls",
		cwd: "/p",
		shell: "zsh",
		file: "/tmp/sh",
		metadata: {},
		time: { started: 5, ...(status === "running" ? {} : { completed: 9 }) },
		...extra,
	});

	async function streamed(events: OpenCodeEvent[]) {
		const translator = new V2EventTranslator();
		let state = createOpenCodeThreadState("s");
		for (const item of events) {
			for (const v1 of await translator.translate(item)) {
				for (const stateEvent of toStateEvents(v1))
					state = reduceOpenCodeThreadState(state, stateEvent);
			}
		}
		return state;
	}

	const loaded = (messages: unknown[]) =>
		reduceOpenCodeThreadState(createOpenCodeThreadState("s"), {
			type: "history.loaded",
			session: null,
			messages: toV1Messages("s", "/p", messages as V2Message[]),
		});

	it("streams a composer shell run into the bash call its history loads as", async () => {
		const live = await streamed([
			ev("evt_1", "session.shell.started", { sessionID: "s", shell: shellInfo("running") }, 5),
			ev(
				"evt_2",
				"session.shell.ended",
				{
					sessionID: "s",
					shell: shellInfo("exited", { exit: 0 }),
					output: { output: "a\nb", cursor: 3, size: 3, truncated: false },
				},
				9,
			),
		]);
		const history = loaded([
			{
				type: "shell",
				id: "msg_1",
				shellID: "sh_1",
				command: "ls",
				status: "exited",
				exit: 0,
				output: { output: "a\nb", cursor: 3, size: 3, truncated: false },
				time: { created: 5, completed: 9 },
			},
		]);

		expect(transcript(live)).toEqual(transcript(history));
		expect(transcript(live)[0]!.parts).toEqual([
			expect.objectContaining({ type: "tool", tool: "bash", status: "completed", output: "a\nb" }),
		]);
	});

	it("streams a skill as the hidden note its history loads as", async () => {
		const live = await streamed([
			ev(
				"evt_7",
				"session.skill.activated",
				{ sessionID: "s", id: "tdd", name: "tdd", text: "Use TDD" },
				3,
			),
		]);
		const history = loaded([
			{ type: "skill", id: "msg_7", skill: "tdd", text: "Use TDD", time: { created: 3 } },
		]);

		expect(transcript(live)).toEqual(transcript(history));
		expect(live.messagesById.msg_7?.parts[0]).toMatchObject({ synthetic: true });
	});

	it("streams a compaction into its request and summary, then announces it", async () => {
		const translator = new V2EventTranslator();
		const out: V1Event[] = [];
		for (const item of [
			ev("evt_c", "session.compaction.started", { sessionID: "s", reason: "manual" }, 4),
			ev(
				"evt_d",
				"session.compaction.ended",
				{ sessionID: "s", reason: "manual", text: "Summary", model: { id: "m", providerID: "p" } },
				6,
			),
		]) {
			out.push(...(await translator.translate(item)));
		}
		let live = createOpenCodeThreadState("s");
		for (const v1 of out)
			for (const stateEvent of toStateEvents(v1))
				live = reduceOpenCodeThreadState(live, stateEvent);
		const history = loaded([
			{
				type: "compaction",
				id: "msg_c",
				reason: "manual",
				status: "completed",
				summary: "Summary",
				model: { id: "m", providerID: "p" },
				time: { created: 4 },
			},
		]);

		expect(transcript(live)).toEqual(transcript(history));
		expect(out.at(-1)).toMatchObject({ type: "session.compacted" });
	});

	it("reports a failed compaction as the chat's error", async () => {
		const out = await new V2EventTranslator().translate(
			ev(
				"evt_f",
				"session.compaction.failed",
				{ sessionID: "s", reason: "manual", error: { type: "x", message: "Too long" } },
				1,
			),
		);
		expect(out).toEqual([
			expect.objectContaining({
				type: "session.error",
				properties: { sessionID: "s", error: { name: "x", data: { message: "Too long" } } },
			}),
		]);
	});
});

describe("formAnswers", () => {
	it("orders answers by question and lists single answers", () => {
		expect(formAnswers({ q1: ["b", "c"], q0: "a", other: "x" })).toEqual([["a"], ["b", "c"]]);
		expect(formAnswers({ q1: "b" })).toEqual([[], ["b"]]);
	});
});

describe("createV2EventSubscriber", () => {
	it("yields translated events, with a fresh translator per connection", async () => {
		const step = { sessionID: "s", assistantMessageID: "m" };
		let connection = 0;
		const subscribe = createV2EventSubscriber(async function* () {
			connection++;
			if (connection === 1) {
				yield event("session.step.started", {
					...step,
					agent: "a",
					model: { id: "x", providerID: "p" },
				});
				yield event("session.text.started", { ...step, ordinal: 0 });
			}
			yield event("session.text.delta", { ...step, ordinal: 0, delta: "hi" });
		});

		const collect = async () => {
			const { stream } = await subscribe({
				signal: new AbortController().signal,
				sseMaxRetryAttempts: 1,
			});
			const out: V1Event[] = [];
			for await (const item of stream) out.push(item as V1Event);
			return out;
		};

		expect((await collect()).at(-1)?.type).toBe("message.part.delta");
		// Reconnected mid-step: the translator knows nothing of the step, so nothing to stream into.
		expect((await collect()).map(({ type }) => type)).toEqual(["message.part.delta"]);
	});
});
