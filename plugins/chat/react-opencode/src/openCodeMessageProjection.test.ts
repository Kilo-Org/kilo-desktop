import { afterEach, describe, expect, it } from "vitest";

import {
	projectOpenCodeThreadMessages,
	projectOpenCodeThreadRepository,
	questionToolCallId,
	setLocalMcpApps,
	toolContentText,
	toolInput,
} from "./openCodeMessageProjection";
import { createOpenCodeThreadState } from "./openCodeThreadState";
import {
	assistant,
	idle,
	MODEL,
	permissionRequest,
	questionForm,
	reasoning,
	runningTool,
	session,
	streamingAssistant,
	subagentTool,
	synthetic,
	system,
	text,
	threadState,
	tool,
	user,
	ZERO_TOKENS,
} from "./testUtils";
import type { OpenCodeThreadState, PendingUserMessage } from "./types";

const project = (state: OpenCodeThreadState) => projectOpenCodeThreadMessages(state);

type Projected = ReturnType<typeof project>[number];
const partsOf = (message: Projected | undefined) =>
	typeof message?.content === "string" ? [] : (message?.content ?? []);

describe("projectOpenCodeThreadMessages: turns and steps", () => {
	it("projects a turn's steps as one assistant message, opening and closing each step", () => {
		const tokens = { ...ZERO_TOKENS, output: 12 };
		const messages = project(
			threadState([
				user("msg_u", "fix it"),
				assistant(
					"msg_s1",
					[reasoning("Look first"), tool("call_1", "read", { path: "a.ts" }, "code")],
					{
						cost: 0.1,
					},
				),
				assistant("msg_s2", [text("Fixed.")], { cost: 0.2, tokens }),
				idle("msg_idle"),
			]),
		);

		expect(messages.map((message) => [message.id, message.role])).toEqual([
			["msg_u", "user"],
			["msg_s1", "assistant"],
		]);
		expect(messages[1]?.content).toEqual([
			{ type: "data", name: "opencode-step-start", data: { id: "msg_s1", depth: 0 } },
			{ type: "reasoning", text: "Look first", parentId: "msg_s1" },
			expect.objectContaining({ type: "tool-call", toolCallId: "call_1", parentId: "msg_s1" }),
			{
				type: "data",
				name: "opencode-step-finish",
				data: { id: "msg_s1", reason: "tool-calls", cost: 0.1, tokens: ZERO_TOKENS },
			},
			{ type: "data", name: "opencode-step-start", data: { id: "msg_s2", depth: 0 } },
			{ type: "text", text: "Fixed." },
			{
				type: "data",
				name: "opencode-step-finish",
				data: { id: "msg_s2", reason: "stop", cost: 0.2, tokens },
			},
		]);
		expect(messages[1]?.status).toEqual({ type: "complete", reason: "stop" });
	});

	it("carries the v2 messages behind each projected message and the turn's model and usage", () => {
		const steps = [
			assistant("msg_s1", [tool("call_1", "read")], { cost: 0.1 }),
			assistant("msg_s2", [text("Done")], {
				cost: 0.2,
				tokens: { ...ZERO_TOKENS, input: 5 },
				agent: "plan",
			}),
		];
		const end = idle("msg_idle");
		const prompt = user("msg_u");
		const [projectedUser, projectedTurn] = project(threadState([prompt, ...steps, end]));

		expect(projectedUser?.metadata?.custom).toEqual({ opencode: { messages: [prompt] } });
		expect(projectedTurn?.metadata?.custom).toEqual({
			opencode: { messages: [...steps, end] },
			modelID: MODEL.id,
			providerID: MODEL.providerID,
			agent: "plan",
			cost: expect.closeTo(0.3),
			tokens: { ...ZERO_TOKENS, input: 5 },
		});
	});

	it("leaves a streaming step open", () => {
		const [turn] = project(
			threadState([streamingAssistant("msg_s1", [text("Work")])], { running: true }),
		);

		expect(turn?.content).toEqual([
			{ type: "data", name: "opencode-step-start", data: { id: "msg_s1", depth: 0 } },
			{ type: "text", text: "Work" },
		]);
		expect(turn?.status).toEqual({ type: "running" });
	});

	it("starts a new turn at each user message", () => {
		const messages = project(
			threadState([user("msg_1"), assistant("msg_2"), user("msg_3"), assistant("msg_4")]),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
	});

	it("omits reasoning that is empty once redactions are removed", () => {
		const [turn] = project(
			threadState([assistant("msg_s1", [reasoning("[REDACTED]"), text("Hi")])]),
		);

		expect(partsOf(turn).some((part) => part.type === "reasoning")).toBe(false);
	});

	it("normalizes escaped newlines in reasoning", () => {
		const [turn] = project(
			threadState([assistant("msg_s1", [reasoning("one\\ntwo\\r\\nthree\\tfour")])]),
		);

		expect(partsOf(turn).find((part) => part.type === "reasoning")).toMatchObject({
			text: "one\ntwo\nthree\tfour",
		});
	});
});

describe("projectOpenCodeThreadMessages: Kilo's own context", () => {
	it("projects neither synthetic notes nor system instructions", () => {
		const messages = project(
			threadState([
				synthetic("msg_syn", "The user attached a file"),
				system("msg_sys", "Instructions updated"),
				user("msg_u"),
				{ id: "msg_agent", type: "agent-selected", agent: "plan", time: { created: 1 } } as never,
				assistant("msg_a", [text("Hi")]),
			]),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_u", "msg_a"]);
	});

	it("keeps a turn's steps together across a synthetic note between them", () => {
		const messages = project(
			threadState([
				user("msg_u"),
				assistant("msg_s1", [tool("call_1", "read")]),
				synthetic("msg_syn", "Background job finished"),
				assistant("msg_s2", [text("Done")]),
			]),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_u", "msg_s1"]);
		expect(messages[1]?.metadata?.custom?.opencode).toMatchObject({
			messages: [{ id: "msg_s1" }, { id: "msg_s2" }],
		});
	});

	it("ignores an idle message with no turn before it", () => {
		expect(
			project(threadState([idle("msg_idle"), user("msg_u")])).map((message) => message.id),
		).toEqual(["msg_u"]);
	});
});

describe("projectOpenCodeThreadMessages: tools", () => {
	it("projects a completed tool's input and text output", () => {
		const [turn] = project(
			threadState([
				assistant("msg_s1", [tool("call_1", "read", { path: "README.md" }, "# Readme")]),
			]),
		);

		expect(turn?.content[1]).toEqual({
			type: "tool-call",
			toolCallId: "call_1",
			toolName: "read",
			args: { path: "README.md" },
			argsText: '{"path":"README.md"}',
			result: "# Readme",
			parentId: "msg_s1",
		});
	});

	it("projects a failed tool's error as an error result", () => {
		const [turn] = project(
			threadState([
				assistant("msg_s1", [
					tool(
						"call_1",
						"shell",
						{ command: "rm" },
						{ error: { type: "tool", message: "Denied" } },
					),
				]),
			]),
		);

		expect(turn?.content[1]).toMatchObject({ result: "Denied", isError: true });
	});

	it("projects a running tool without a result", () => {
		const [turn] = project(
			threadState(
				[streamingAssistant("msg_s1", [runningTool("call_1", "shell", { command: "ls" })])],
				{
					running: true,
				},
			),
		);

		expect(turn?.content[1]).toMatchObject({ args: { command: "ls" } });
		expect(turn?.content[1]).not.toHaveProperty("result");
	});

	it("reads a streaming call's partial input once it parses", () => {
		const streaming = (input: string) =>
			({ ...tool("call_1", "write"), state: { status: "streaming", input } }) as const;

		expect(toolInput(streaming('{"path":"a.ts"}'))).toEqual({ path: "a.ts" });
		expect(toolInput(streaming('{"path":'))).toEqual({});
		expect(toolInput(streaming(""))).toEqual({});
	});

	it("joins a tool's text content, skipping files", () => {
		const read = tool("call_1", "read", {}, "one", {
			state: {
				status: "completed",
				input: {},
				content: [
					{ type: "text", text: "one" },
					{ type: "file", uri: "file:///a.png", mime: "image/png" },
					{ type: "text", text: "two" },
				],
			},
		});

		expect(toolContentText(read)).toBe("one\ntwo");
		expect(toolContentText(runningTool("call_2", "read"))).toBeUndefined();
	});

	describe("MCP apps", () => {
		afterEach(() => setLocalMcpApps({}));

		it("stamps an MCP app from the local registry or the tool's metadata", () => {
			setLocalMcpApps({ chart: { resourceUri: "ui://charts/main", serverId: "charts" } });
			const fromMetadata = tool("call_2", "map", {}, "ok", {
				state: {
					status: "completed",
					input: {},
					content: [{ type: "text", text: "ok" }],
					metadata: { mcpApp: { resourceUri: "ui://maps/main", serverId: "maps" } },
				},
			});
			const [turn] = project(
				threadState([assistant("msg_s1", [tool("call_1", "chart"), fromMetadata])]),
			);

			expect(turn?.content[1]).toMatchObject({
				mcp: { app: { resourceUri: "ui://charts/main", serverId: "charts" } },
			});
			expect(turn?.content[2]).toMatchObject({
				mcp: { app: { resourceUri: "ui://maps/main", serverId: "maps" } },
			});
		});
	});
});

describe("projectOpenCodeThreadMessages: subagents", () => {
	const childState = (sessionId: string, overrides: Partial<OpenCodeThreadState> = {}) => ({
		...createOpenCodeThreadState(sessionId),
		loadState: { type: "ready" } as const,
		messages: [user(`${sessionId}_u`, "Look"), assistant(`${sessionId}_a`, [text("Found it")])],
		...overrides,
	});

	it("nests a loaded child session's transcript under its subagent call", () => {
		const grandchild = childState("ses_grandchild");
		const child = childState("ses_child", {
			messages: [assistant("ses_child_a", [subagentTool("call_child", "ses_grandchild")])],
			childSessionsById: { ses_grandchild: grandchild },
		});
		const [turn] = project(
			threadState([assistant("msg_s1", [subagentTool("call_1", "ses_child")])], {
				childSessionsById: { ses_child: child },
			}),
		);

		const call = turn?.content[1] as {
			messages?: readonly { role: string; content: readonly unknown[] }[];
		};
		expect(call.messages?.map((message) => message.role)).toEqual(["assistant"]);
		const nested = call.messages?.[0]?.content[1] as { messages?: readonly { role: string }[] };
		expect(nested.messages?.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("omits the nested transcript until the child session has loaded", () => {
		const [turn] = project(
			threadState([assistant("msg_s1", [subagentTool("call_1", "ses_child")])], {
				childSessionsById: {
					ses_child: childState("ses_child", { loadState: { type: "loading" } }),
				},
			}),
		);

		expect(turn?.content[1]).not.toHaveProperty("messages");
	});

	it("nests nothing under other tools, even with a session id in their metadata", () => {
		const [turn] = project(
			threadState(
				[assistant("msg_s1", [runningTool("call_1", "read", {}, { sessionID: "ses_child" })])],
				{
					childSessionsById: { ses_child: childState("ses_child") },
				},
			),
		);

		expect(turn?.content[1]).not.toHaveProperty("messages");
	});

	it("reuses the projected child transcript while the child state is unchanged", () => {
		const child = childState("ses_child");
		const state = threadState([assistant("msg_s1", [subagentTool("call_1", "ses_child")])], {
			childSessionsById: { ses_child: child },
		});
		const nested = (projected: ReturnType<typeof project>) =>
			(partsOf(projected[0])[1] as { messages?: unknown } | undefined)?.messages;

		const first = nested(project(state));
		expect(nested(project({ ...state, running: true }))).toBe(first);
		expect(
			nested(
				project({
					...state,
					childSessionsById: { ses_child: { ...child, messages: [...child.messages] } },
				}),
			),
		).not.toBe(first);
	});
});

describe("projectOpenCodeThreadMessages: permissions and questions", () => {
	const turnWithCall = [
		user("msg_u"),
		assistant("msg_s1", [runningTool("call_1", "edit", { path: "a.ts" })]),
	];

	it("requires action while a tool call waits on a permission, offering its replies", () => {
		const request = permissionRequest("per_1", {
			save: ["edit:src/**"],
			source: { type: "tool", messageID: "msg_s1", id: "call_1" },
		});
		const [, turn] = project(
			threadState(turnWithCall, {
				running: true,
				interactions: {
					...createOpenCodeThreadState("ses_1").interactions,
					permissions: { pending: { per_1: request }, resolved: {} },
				},
			}),
		);

		expect(turn?.status).toEqual({ type: "requires-action", reason: "tool-calls" });
		expect(turn?.content[1]).toMatchObject({
			approval: {
				id: "per_1",
				options: [
					{ id: "once", kind: "allow-once" },
					{ id: "always", kind: "allow-always", grants: ["edit:src/**"] },
					{ id: "reject", kind: "reject-once" },
				],
			},
		});
	});

	it("records a resolved permission's decision on its tool call", () => {
		const request = permissionRequest("per_1", {
			source: { type: "tool", messageID: "msg_s1", id: "call_1" },
		});
		const [, turn] = project(
			threadState(turnWithCall, {
				interactions: {
					...createOpenCodeThreadState("ses_1").interactions,
					permissions: {
						pending: {},
						resolved: { per_1: { request, reply: "reject", respondedAt: 1 } },
					},
				},
			}),
		);

		expect(turn?.content[1]).toMatchObject({
			approval: { id: "per_1", approved: false, optionId: "reject" },
		});
		expect(turn?.status).not.toMatchObject({ type: "requires-action" });
	});

	it("requires action while a tool call waits on a question form", () => {
		const form = questionForm("frm_1", undefined, { toolCallId: "call_1" });
		const [, turn] = project(
			threadState(turnWithCall, {
				running: true,
				interactions: {
					...createOpenCodeThreadState("ses_1").interactions,
					questions: { pending: { frm_1: form }, answered: {}, rejected: {} },
				},
			}),
		);

		expect(questionToolCallId(form)).toBe("call_1");
		expect(turn?.status).toEqual({ type: "requires-action", reason: "tool-calls" });
	});

	it("reads no tool call from a form without one", () => {
		expect(questionToolCallId(questionForm("frm_1"))).toBeUndefined();
		expect(questionToolCallId({ metadata: { tool: { id: 7 } } })).toBeUndefined();
	});
});

describe("projectOpenCodeThreadMessages: errors", () => {
	it("reports a failed step's error", () => {
		const [turn] = project(
			threadState([
				assistant("msg_s1", [], {
					finish: "error",
					error: { type: "api", message: "Rate limited" },
				}),
				idle("msg_idle", "failed"),
			]),
		);

		expect(turn?.status).toEqual({ type: "incomplete", reason: "error", error: "Rate limited" });
	});

	it("reports a failed turn's error from its idle message", () => {
		const [turn] = project(
			threadState([
				assistant("msg_s1", [text("Partial")]),
				idle("msg_idle", "failed", { type: "provider", message: "Overloaded" }),
			]),
		);

		expect(turn?.status).toEqual({ type: "incomplete", reason: "error", error: "Overloaded" });
	});
});

describe("user message projection", () => {
	it("projects a user message's text and inline image as a complete attachment", () => {
		const [message] = project(
			threadState([
				user("msg_u", "look at this", {
					files: [
						{ data: "QUJD", mime: "image/png", source: { type: "inline" }, name: "shot.png" },
					],
				}),
			]),
		);

		expect(message?.content).toEqual([{ type: "text", text: "look at this" }]);
		expect(message?.attachments).toEqual([
			{
				id: "msg_u:0",
				type: "image",
				name: "shot.png",
				contentType: "image/png",
				status: { type: "complete" },
				content: [{ type: "image", image: "data:image/png;base64,QUJD", filename: "shot.png" }],
			},
		]);
	});

	it("projects a file by URI as a file attachment", () => {
		const [message] = project(
			threadState([
				user("msg_u", "", {
					files: [
						{
							data: "",
							mime: "application/pdf",
							source: { type: "uri", uri: "file:///docs/spec.pdf" },
						},
					],
				}),
			]),
		);

		expect(message?.content).toEqual([]);
		expect(message?.attachments).toEqual([
			{
				id: "msg_u:0",
				type: "file",
				name: "file",
				contentType: "application/pdf",
				status: { type: "complete" },
				content: [
					{
						type: "file",
						filename: "file",
						data: "file:///docs/spec.pdf",
						mimeType: "application/pdf",
					},
				],
			},
		]);
	});

	it("keeps a stored data URL as it is", () => {
		const [message] = project(
			threadState([
				user("msg_u", "", {
					files: [
						{ data: "data:image/gif;base64,R0lG", mime: "image/gif", source: { type: "inline" } },
					],
				}),
			]),
		);

		expect(message?.attachments?.[0]?.content?.[0]).toMatchObject({
			image: "data:image/gif;base64,R0lG",
		});
	});

	it("splits a pending prompt's parts between content and attachments", () => {
		const pending: PendingUserMessage = {
			clientId: "msg_p",
			sessionId: "ses_1",
			createdAt: 5,
			parts: [
				{ type: "text", text: "look at this" },
				{ type: "image", image: "data:image/png;base64,QUJD", filename: "shot.png" },
				{ type: "file", data: "JVBERi0=", mimeType: "application/pdf", filename: "a.pdf" },
			],
			status: "pending",
		};
		const [message] = project(threadState([], { pendingUserMessages: { msg_p: pending } }));

		expect(message?.id).toBe("local:msg_p");
		expect(message?.content).toEqual([{ type: "text", text: "look at this" }]);
		expect(message?.attachments).toEqual([
			{
				id: "0",
				type: "image",
				name: "shot.png",
				contentType: "image/png",
				status: { type: "complete" },
				content: [pending.parts[1]],
			},
			{
				id: "1",
				type: "file",
				name: "a.pdf",
				contentType: "application/pdf",
				status: { type: "complete" },
				content: [pending.parts[2]],
			},
		]);
		expect(message?.metadata?.custom?.opencode).toEqual({
			messages: [],
			pending: true,
			clientId: "msg_p",
			error: undefined,
		});
	});

	it("reports a pending prompt that failed to send", () => {
		const pending: PendingUserMessage = {
			clientId: "msg_p",
			sessionId: "ses_1",
			createdAt: 5,
			parts: [{ type: "text", text: "hi" }],
			status: "failed",
			error: new Error("Unauthorized"),
		};
		const [message] = project(threadState([], { pendingUserMessages: { msg_p: pending } }));

		expect(message?.metadata?.custom?.opencode).toMatchObject({ error: "Unauthorized" });
	});

	it("places pending prompts among server messages by time", () => {
		const first = user("msg_1", "a", { time: { created: 10 } });
		const later = assistant("msg_2", [], { time: { created: 30, completed: 31 } });
		const pending: PendingUserMessage = {
			clientId: "msg_p",
			sessionId: "ses_1",
			createdAt: 20,
			parts: [{ type: "text", text: "b" }],
			status: "pending",
		};
		const messages = project(
			threadState([first, later], { pendingUserMessages: { msg_p: pending } }),
		);

		expect(messages.map((message) => message.id)).toEqual(["msg_1", "local:msg_p", "msg_2"]);
	});
});

describe("projectOpenCodeThreadRepository", () => {
	it("chains the projected messages into one branch", () => {
		const repository = projectOpenCodeThreadRepository(
			threadState([user("msg_1"), assistant("msg_2")], { session: session() }),
		);

		expect(repository.messages.map(({ parentId, message }) => [parentId, message.id])).toEqual([
			[null, "msg_1"],
			["msg_1", "msg_2"],
		]);
	});
});
