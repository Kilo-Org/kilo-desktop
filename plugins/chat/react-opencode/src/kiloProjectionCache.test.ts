import {
	createOpenCodeProjectionCache,
	createOpenCodeThreadState,
	projectOpenCodeThreadRepository,
	type OpenCodeServerMessage,
	type OpenCodeThreadState,
} from "./index";
import { describe, expect, it } from "vitest";

/*
 * Projection cache in Desktop's fork (requirement in docs/kilo-v2.md): a streamed token re-projects
 * only the message it changed. Every other message keeps its ThreadMessage,
 * so its components skip the render; that keeps a token's cost flat as the
 * session grows.
 */

const assistant = (
	id: string,
	created: number,
	parts: Array<Record<string, unknown>>,
	info: Record<string, unknown> = {},
): OpenCodeServerMessage => ({
	id,
	info: {
		id,
		role: "assistant",
		sessionID: "ses_1",
		modelID: "model",
		providerID: "provider",
		mode: "primary",
		path: { cwd: "/", root: "/" },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created, completed: created + 1 },
		finish: "stop",
		...info,
	} as never,
	parts: parts.map((part, index) => ({
		id: `${id}_p${index}`,
		sessionID: "ses_1",
		messageID: id,
		...part,
	})) as never,
	shadowParts: undefined,
});

const user = (id: string, created: number): OpenCodeServerMessage => ({
	id,
	info: { id, role: "user", sessionID: "ses_1", time: { created } } as never,
	parts: [{ id: `${id}_p`, sessionID: "ses_1", messageID: id, type: "text", text: "go" }] as never,
	shadowParts: undefined,
});

const tool = (callID: string) => ({
	type: "tool",
	tool: "edit",
	callID,
	state: {
		status: "completed",
		input: { filePath: "/a.ts" },
		output: "ok",
		time: { start: 1, end: 2 },
	},
});

// One base, as the reducer keeps every object a token doesn't change.
const base = createOpenCodeThreadState("ses_1");

const stateOf = (
	messages: readonly OpenCodeServerMessage[],
	overrides: Partial<OpenCodeThreadState> = {},
): OpenCodeThreadState => ({
	...base,
	sessionStatus: { type: "busy" },
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
	...overrides,
});

const threadMessages = (repository: ReturnType<typeof projectOpenCodeThreadRepository>) =>
	repository.messages.map(({ message }) => message);

/** A session whose last turn is still streaming into its second step. */
function streaming() {
	const settled = [
		user("msg-1", 1),
		assistant("msg-2", 2, [{ type: "text", text: "First answer" }, tool("call-a")]),
		user("msg-3", 3),
	];
	const step = assistant("msg-4", 4, [tool("call-b")], { finish: "tool-calls" });
	const live = assistant("msg-5", 5, [{ type: "text", text: "Work" }], { finish: undefined });
	return { messages: [...settled, step, live], live };
}

const withText = (message: OpenCodeServerMessage, text: string): OpenCodeServerMessage => ({
	...message,
	parts: message.parts.map((part, index) => (index === 0 ? { ...part, text } : part)) as never,
});

describe("projectOpenCodeThreadRepository with a projection cache", () => {
	it("keeps every message a token didn't touch", () => {
		const cache = createOpenCodeProjectionCache();
		const { messages, live } = streaming();
		const before = threadMessages(projectOpenCodeThreadRepository(stateOf(messages), {}, cache));
		const after = threadMessages(
			projectOpenCodeThreadRepository(
				stateOf([...messages.slice(0, -1), withText(live, "Working")]),
				{},
				cache,
			),
		);

		expect(after.map((message) => message.id)).toEqual(before.map((message) => message.id));
		expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
		after.slice(0, -1).forEach((message, index) => expect(message).toBe(before[index]));
		expect(after.at(-1)).not.toBe(before.at(-1));
		expect(after.at(-1)?.content.find((part) => part.type === "text")).toMatchObject({
			text: "Working",
		});
	});

	it("projects the same messages as an uncached projection", () => {
		const cache = createOpenCodeProjectionCache();
		const { messages, live } = streaming();
		projectOpenCodeThreadRepository(stateOf(messages), {}, cache);
		const next = stateOf([...messages.slice(0, -1), withText(live, "Working")]);

		const strip = (list: ReturnType<typeof threadMessages>) =>
			list.map(({ createdAt: _createdAt, ...message }) => message);
		expect(strip(threadMessages(projectOpenCodeThreadRepository(next, {}, cache)))).toEqual(
			strip(threadMessages(projectOpenCodeThreadRepository(next))),
		);
	});

	it("keeps a turn's id when its next step starts", () => {
		const cache = createOpenCodeProjectionCache();
		const { messages } = streaming();
		const beforeStep = threadMessages(
			projectOpenCodeThreadRepository(stateOf(messages.slice(0, -1)), {}, cache),
		);
		const afterStep = threadMessages(projectOpenCodeThreadRepository(stateOf(messages), {}, cache));

		expect(beforeStep.at(-1)?.id).toBe("msg-4");
		expect(afterStep.at(-1)?.id).toBe("msg-4");
		expect(afterStep.at(-1)?.status).toEqual({ type: "running" });
	});

	it("re-projects a settled message once the run it belongs to stops", () => {
		const cache = createOpenCodeProjectionCache();
		const { messages } = streaming();
		const running = threadMessages(projectOpenCodeThreadRepository(stateOf(messages), {}, cache));
		const stopped = threadMessages(
			projectOpenCodeThreadRepository(
				stateOf(messages, { sessionStatus: { type: "idle" } }),
				{},
				cache,
			),
		);

		expect(running.at(-1)?.status).toEqual({ type: "running" });
		expect(stopped.at(-1)?.status).toEqual({ type: "incomplete", reason: "cancelled" });
		expect(stopped[1]).toBe(running[1]);
	});

	it("re-projects a message when a permission is asked for one of its tools", () => {
		const cache = createOpenCodeProjectionCache();
		const { messages } = streaming();
		const state = stateOf(messages);
		const before = threadMessages(projectOpenCodeThreadRepository(state, {}, cache));
		const asked = {
			...state.interactions,
			permissions: {
				...state.interactions.permissions,
				pending: {
					per_1: {
						id: "per_1",
						sessionID: "ses_1",
						permission: "edit",
						patterns: ["/a.ts"],
						metadata: {},
						always: [],
						tool: { callID: "call-a", messageID: "msg-2" },
					},
				},
			},
		} as unknown as OpenCodeThreadState["interactions"];
		const after = threadMessages(
			projectOpenCodeThreadRepository({ ...state, interactions: asked }, {}, cache),
		);

		expect(after[1]).not.toBe(before[1]);
		expect(after[1]?.status).toEqual({ type: "requires-action", reason: "tool-calls" });
		expect(after[0]).toBe(before[0]);
	});
});
