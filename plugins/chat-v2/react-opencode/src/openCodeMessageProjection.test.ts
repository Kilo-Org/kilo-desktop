import type { SessionMessageInfo } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import {
	createOpenCodeProjectionCache,
	projectOpenCodeThreadMessages,
	projectOpenCodeThreadRepository,
} from "./openCodeMessageProjection";
import { createOpenCodeThreadState } from "./openCodeThreadState";
import type {
	KiloAssistantContent,
	OpenCodePermissionRequest,
	OpenCodeThreadState,
	PendingUserMessage,
	SessionMessageAssistant,
} from "./types";

const user = (id: string, text: string, created = 1, files?: unknown[]): SessionMessageInfo =>
	({
		id,
		type: "user",
		text,
		time: { created },
		...(files ? { files } : {}),
	}) as SessionMessageInfo;

const step = (
	id: string,
	content: KiloAssistantContent[],
	patch: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => ({
	id,
	type: "assistant",
	agent: "code",
	model: { providerID: "kilo", id: "m" },
	time: { created: 2, completed: 3 },
	finish: "stop",
	content,
	...patch,
});

const tool = (id: string, name: string, state: Record<string, unknown>): KiloAssistantContent =>
	({ type: "tool", id, name, time: { created: 1 }, state }) as KiloAssistantContent;

const completed = (input: Record<string, unknown>, text: string, metadata = {}) => ({
	status: "completed",
	input,
	content: [{ type: "text", text }],
	metadata,
});

const stateOf = (
	messages: SessionMessageInfo[],
	patch: Partial<OpenCodeThreadState> = {},
): OpenCodeThreadState => ({
	...createOpenCodeThreadState("ses_1"),
	loadState: { type: "ready" },
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
	...patch,
});

const project = (messages: SessionMessageInfo[], patch: Partial<OpenCodeThreadState> = {}) =>
	projectOpenCodeThreadMessages(stateOf(messages, patch));

const contentOf = (message: { content: unknown } | undefined) =>
	(message?.content ?? []) as { type: string; [key: string]: unknown }[];

describe("projectOpenCodeThreadMessages", () => {
	it("projects a run of steps as one assistant message, each step's content under its marker", () => {
		const messages = project([
			user("msg_u", "Read it"),
			step("msg_a1", [{ type: "text", text: "Let me look." }], { finish: "tool-calls" }),
			step("msg_a2", [
				{ type: "reasoning", text: "\\nDone\\t[REDACTED]" },
				{ type: "text", text: "It says hi." },
			]),
		]);

		expect(messages.map(({ id, role }) => [id, role])).toEqual([
			["msg_u", "user"],
			["msg_a1", "assistant"],
		]);
		const assistant = messages[1]!;
		expect(contentOf(assistant).map((part) => [part.type, part.name ?? part.text])).toEqual([
			["data", "opencode-step-start"],
			["text", "Let me look."],
			["data", "opencode-step-finish"],
			["data", "opencode-step-start"],
			["reasoning", "Done"],
			["text", "It says hi."],
			["data", "opencode-step-finish"],
		]);
		expect(assistant.status).toEqual({ type: "complete", reason: "stop" });
		expect(assistant.metadata?.custom).toMatchObject({
			opencode: { message: { id: "msg_a2" }, messages: [{ id: "msg_a1" }, { id: "msg_a2" }] },
			modelID: "m",
			providerID: "kilo",
			agent: "code",
		});
	});

	it("projects tool calls with Kilo v2's names, inputs and text output", () => {
		const [assistant] = project([
			step("msg_a", [
				tool("call_1", "shell", completed({ command: "ls" }, "a\nb", { exit: 0 })),
				tool("call_2", "read", {
					status: "error",
					input: { path: "x" },
					error: { type: "tool", message: "missing" },
				}),
				tool("call_3", "patch", { status: "streaming", input: '{"pat' }),
			]),
		]);
		const calls = contentOf(assistant).filter((part) => part.type === "tool-call");
		expect(calls).toEqual([
			expect.objectContaining({
				toolCallId: "call_1",
				toolName: "shell",
				args: { command: "ls" },
				result: "a\nb",
				parentId: "msg_a",
			}),
			expect.objectContaining({
				toolCallId: "call_2",
				toolName: "read",
				args: { path: "x" },
				result: "missing",
				isError: true,
			}),
			expect.objectContaining({ toolCallId: "call_3", toolName: "patch", args: {} }),
		]);
		expect(calls[2]).not.toHaveProperty("result");
	});

	it("shows composer shell runs and compactions, and hides Kilo's context", () => {
		const messages = project([
			{ id: "msg_n", type: "synthetic", text: "note", time: { created: 1 } },
			{ id: "msg_k", type: "skill", skill: "s", name: "S", text: "use", time: { created: 1 } },
			{ id: "msg_m", type: "agent-switched", agent: "plan", time: { created: 1 } },
			{
				id: "msg_s",
				type: "shell",
				shellID: "sh_1",
				command: "ls",
				status: "exited",
				exit: 0,
				output: { output: "a", cursor: 1, size: 1, truncated: false },
				time: { created: 2 },
			},
			{
				id: "msg_c",
				type: "compaction",
				status: "completed",
				reason: "manual",
				summary: "Summary",
				time: { created: 3 },
			},
		]);
		expect(messages.map(({ id }) => id)).toEqual(["msg_s", "msg_c"]);
		expect(contentOf(messages[0])).toEqual([
			expect.objectContaining({
				type: "tool-call",
				toolName: "shell",
				args: { command: "ls" },
				result: "a",
			}),
		]);
		expect(contentOf(messages[1])).toEqual([
			expect.objectContaining({
				type: "data",
				name: "opencode-compaction",
				data: expect.objectContaining({ status: "completed", reason: "manual" }),
			}),
			{ type: "text", text: "Summary" },
		]);
	});

	it("continues a reply past a turn's end into a background task's continuation", () => {
		const messages = project([
			user("msg_u", "Investigate"),
			step("msg_a1", [tool("call_1", "subagent", completed({ agent: "explore" }, "started"))], {
				finish: "tool-calls",
			}),
			{ id: "msg_i", type: "idle", outcome: "succeeded", time: { created: 4 } },
			{
				id: "msg_n",
				type: "synthetic",
				text: "Background task completed",
				metadata: { background: true },
				time: { created: 5 },
			},
			step("msg_a2", [{ type: "text", text: "Here is the comparison." }], {
				time: { created: 6, completed: 7 },
			}),
		]);
		expect(messages.map(({ id }) => id)).toEqual(["msg_u", "msg_a1"]);
		expect(contentOf(messages[1]).filter((part) => part.type !== "data")).toEqual([
			expect.objectContaining({ type: "tool-call", toolName: "subagent" }),
			{ type: "text", text: "Here is the comparison." },
		]);
	});

	it("reads a step's state as the message's status", () => {
		const running = step("msg_a", [], { time: { created: 2 }, finish: undefined } as never);
		delete (running as { finish?: unknown }).finish;
		expect(project([running], { runState: { type: "streaming" } })[0]?.status).toEqual({
			type: "running",
		});
		expect(project([running])[0]?.status).toEqual({ type: "incomplete", reason: "cancelled" });
		expect(
			project([step("msg_a", [], { error: { type: "provider", message: "Boom" } })])[0]?.status,
		).toEqual({ type: "incomplete", reason: "error", error: "Boom" });
		expect(project([step("msg_a", [], { finish: "tool-calls" })])[0]?.status).toEqual({
			type: "incomplete",
			reason: "cancelled",
		});
	});

	it("holds a tool call waiting on a permission, and records how it was answered", () => {
		const request = {
			id: "per_1",
			sessionID: "ses_1",
			action: "shell",
			resources: ["ls"],
			save: ["ls *"],
			source: { type: "tool", messageID: "msg_a", id: "call_1" },
			askedAt: 1,
		} as unknown as OpenCodePermissionRequest;
		const messages = [
			step("msg_a", [tool("call_1", "shell", { status: "running", input: {}, metadata: {} })]),
		];
		const base = createOpenCodeThreadState("ses_1").interactions;
		const waiting = project(messages, {
			interactions: { ...base, permissions: { pending: { per_1: request }, resolved: {} } },
		})[0]!;
		expect(waiting.status).toEqual({ type: "requires-action", reason: "tool-calls" });
		expect(contentOf(waiting)[1]).toMatchObject({ approval: { id: "per_1" } });

		const answered = project(messages, {
			interactions: {
				...base,
				permissions: {
					pending: {},
					resolved: { per_1: { request, reply: "once", respondedAt: 2 } },
				},
			},
		})[0]!;
		expect(contentOf(answered)[1]).toMatchObject({
			approval: { id: "per_1", approved: true, optionId: "once" },
		});
	});

	it("nests a subagent's child transcript once it has loaded, reusing it while unchanged", () => {
		const subagent = tool("call_1", "subagent", {
			status: "running",
			input: { agent: "explore" },
			metadata: { sessionID: "ses_child" },
		});
		const child = stateOf([user("msg_cu", "child prompt")]);
		const loading = { ...child, loadState: { type: "loading" } } as OpenCodeThreadState;
		const messages = [step("msg_a", [subagent])];

		expect(
			contentOf(project(messages, { childSessionsById: { ses_child: loading } })[0])[1],
		).not.toHaveProperty("messages");

		const first = contentOf(project(messages, { childSessionsById: { ses_child: child } })[0])[1];
		const second = contentOf(project(messages, { childSessionsById: { ses_child: child } })[0])[1];
		expect(first?.messages).toHaveLength(1);
		expect(second?.messages).toBe(first?.messages);
	});

	it("hides messages from the session's revert boundary on", () => {
		const messages = project([user("msg_1", "a"), user("msg_2", "b"), user("msg_3", "c")], {
			session: { revert: { messageID: "msg_2" } } as never,
		});
		expect(messages.map(({ id }) => id)).toEqual(["msg_1"]);
	});
});

describe("user message projection", () => {
	it("projects a prompt's attached files as image and file attachments", () => {
		const [message] = project([
			user("msg_u", "See these", 1, [
				{ data: "AQID", mime: "image/png", name: "a.png", source: { type: "inline" } },
				{ data: "BAUG", mime: "application/pdf", source: { type: "inline" } },
			]),
		]);
		expect(message?.content).toEqual([{ type: "text", text: "See these" }]);
		expect(message?.attachments).toEqual([
			expect.objectContaining({
				type: "image",
				name: "a.png",
				contentType: "image/png",
				content: [{ type: "image", image: "data:image/png;base64,AQID", filename: "a.png" }],
			}),
			expect.objectContaining({
				type: "file",
				name: "file",
				contentType: "application/pdf",
				content: [
					{
						type: "file",
						filename: "file",
						data: "data:application/pdf;base64,BAUG",
						mimeType: "application/pdf",
					},
				],
			}),
		]);
	});

	it("splits a pending prompt's parts between content and attachments, in time order", () => {
		const pending: PendingUserMessage = {
			clientId: "c1",
			messageId: "msg_p",
			sessionId: "ses_1",
			createdAt: 5,
			parentId: null,
			sourceId: null,
			runConfig: undefined,
			contentText: "hi",
			parts: [
				{ type: "text", text: "hi" },
				{ type: "image", image: "data:image/png;base64,AQID", filename: "a.png" },
			],
			status: "pending",
		};
		const messages = project([user("msg_u", "first", 1)], {
			pendingUserMessages: { c1: pending },
		});
		expect(messages.map(({ id }) => id)).toEqual(["msg_u", "local:c1"]);
		expect(messages[1]?.content).toEqual([{ type: "text", text: "hi" }]);
		expect(messages[1]?.attachments).toEqual([
			expect.objectContaining({ type: "image", name: "a.png", contentType: "image/png" }),
		]);
	});
});

describe("projectOpenCodeThreadRepository with a cache", () => {
	it("keeps a message's projection while its sources are unchanged", () => {
		const cache = createOpenCodeProjectionCache();
		const state = stateOf([user("msg_u", "a"), step("msg_a", [{ type: "text", text: "b" }])]);
		const first = projectOpenCodeThreadRepository(state, {}, cache).messages;
		const changed = {
			...state,
			messagesById: {
				...state.messagesById,
				msg_a: step("msg_a", [{ type: "text", text: "bc" }]),
			},
		};
		const second = projectOpenCodeThreadRepository(changed, {}, cache).messages;
		expect(second[0]?.message).toBe(first[0]?.message);
		expect(second[1]?.message).not.toBe(first[1]?.message);
	});
});
