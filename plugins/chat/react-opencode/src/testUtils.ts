// Kilo v2 fixtures for the fork's tests: data in the shapes `@kilocode/client`
// serves, a fake client whose methods are `vi.fn`s with v2 signatures, and a
// fake event source emitting frames normalized as the real one normalizes them.
import type {
	FormInfo,
	OpenCodeClient,
	PermissionRequest,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageAssistantTool,
	SessionMessageIdle,
	SessionMessageInfo,
	SessionMessagesResponse,
	SessionMessageUser,
	SessionStructuredError,
} from "@kilocode/client";
import { vi } from "vitest";

import { normalizeEventPayload, STREAM_RECONNECTED_EVENT_TYPE } from "./OpenCodeEventSource";
import { createOpenCodeThreadState } from "./openCodeThreadState";
import type { OpenCodeServerEvent, OpenCodeThreadState, Transcript } from "./types";

export const SESSION_ID = "ses_1";
export const MODEL = { providerID: "acme", id: "fast-1" } as const;
export const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

let clock = 1_000;
/** A time later than every earlier one, so fixtures sort in the order they were built. */
export const nextTime = () => (clock += 10);

export function session(id = SESSION_ID, patch: Partial<SessionInfo> = {}): SessionInfo {
	return {
		id,
		projectID: "project",
		cost: 0,
		tokens: ZERO_TOKENS,
		title: `Chat ${id}`,
		location: { directory: "/projects/app" },
		time: { created: 1, updated: 1 },
		...patch,
	};
}

export function user(
	id: string,
	text = "go",
	patch: Partial<SessionMessageUser> = {},
): SessionMessageUser {
	return { id, type: "user", text, time: { created: nextTime() }, ...patch };
}

export const text = (value: string) => ({ type: "text" as const, text: value });

export const reasoning = (value: string) => ({
	type: "reasoning" as const,
	text: value,
	time: { created: 1, completed: 2 },
});

/** A completed tool call; `{ error }` makes it a failed one. */
export function tool(
	id: string,
	name: string,
	input: Record<string, unknown> = {},
	output: string | { readonly error: SessionStructuredError } = "ok",
	patch: Partial<SessionMessageAssistantTool> = {},
): SessionMessageAssistantTool {
	return {
		type: "tool",
		id,
		name,
		state:
			typeof output === "string"
				? { status: "completed", input: input as never, content: [{ type: "text", text: output }] }
				: { status: "error", input: input as never, error: output.error },
		time: { created: 1, ran: 1, completed: 2 },
		...patch,
	};
}

export function runningTool(
	id: string,
	name: string,
	input: Record<string, unknown> = {},
	metadata: Record<string, unknown> = {},
): SessionMessageAssistantTool {
	return {
		type: "tool",
		id,
		name,
		state: { status: "running", input: input as never, metadata: metadata as never },
		time: { created: 1, ran: 1 },
	};
}

/** A subagent call running in `childSessionId`. */
export const subagentTool = (id: string, childSessionId: string) =>
	runningTool(
		id,
		"subagent",
		{ agent: "explore", description: "Inspect", prompt: "Look" },
		{
			sessionID: childSessionId,
		},
	);

/** A finished model step; `finish` follows its content unless patched. */
export function assistant(
	id: string,
	content: SessionMessageAssistant["content"] = [],
	patch: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant {
	const created = nextTime();
	return {
		id,
		type: "assistant",
		agent: "code",
		model: MODEL,
		content,
		time: { created, completed: created + 5 },
		finish: content.some((item) => item.type === "tool") ? "tool-calls" : "stop",
		cost: 0,
		tokens: ZERO_TOKENS,
		...patch,
	};
}

/** A model step still streaming. */
export function streamingAssistant(
	id: string,
	content: SessionMessageAssistant["content"] = [],
): SessionMessageAssistant {
	return {
		id,
		type: "assistant",
		agent: "code",
		model: MODEL,
		content,
		time: { created: nextTime() },
	};
}

export function idle(
	id: string,
	outcome: SessionMessageIdle["outcome"] = "succeeded",
	error?: SessionStructuredError,
): SessionMessageIdle {
	return { id, type: "idle", outcome, time: { created: nextTime() }, ...(error ? { error } : {}) };
}

export const synthetic = (id: string, value: string): SessionMessageInfo => ({
	id,
	type: "synthetic",
	text: value,
	time: { created: nextTime() },
});

export const system = (id: string, value: string): SessionMessageInfo => ({
	id,
	type: "system",
	text: value,
	time: { created: nextTime() },
});

export function permissionRequest(
	id: string,
	patch: Partial<PermissionRequest> = {},
): PermissionRequest {
	return { id, sessionID: SESSION_ID, action: "edit", resources: ["src/a.ts"], ...patch };
}

/** A question tool form: one field per question keyed `q0, q1, …`. */
export function questionForm(
	id: string,
	questions: readonly {
		readonly header: string;
		readonly question: string;
		readonly options: readonly string[];
		readonly multiple?: boolean;
	}[] = [{ header: "Confirm", question: "Continue?", options: ["Yes", "No"] }],
	patch: Partial<FormInfo> & { readonly toolCallId?: string } = {},
): FormInfo {
	const { toolCallId, ...rest } = patch;
	return {
		id,
		sessionID: SESSION_ID,
		title: "Questions",
		metadata: {
			kind: "question",
			...(toolCallId ? { tool: { messageID: "msg_tool", id: toolCallId } } : {}),
		},
		fields: questions.map((question, index) => ({
			key: `q${index}`,
			title: question.header,
			description: question.question,
			type: question.multiple === true ? "multiselect" : "string",
			options: question.options.map((label) => ({ value: label, label })),
			custom: true,
		})) as never,
		...rest,
	};
}

/** A loaded thread holding `messages`. */
export const threadState = (
	messages: Transcript = [],
	overrides: Partial<OpenCodeThreadState> = {},
): OpenCodeThreadState => ({
	...createOpenCodeThreadState(SESSION_ID),
	session: session(),
	loadState: { type: "ready" },
	messages,
	...overrides,
});

let eventSequence = 0;

/** A v2 frame as the event source delivers it to the thread layer. */
export function serverEvent(
	type: string,
	data: Record<string, unknown> = {},
	frame: { readonly id?: string; readonly created?: number } = {},
): OpenCodeServerEvent {
	eventSequence += 1;
	return normalizeEventPayload({
		id: frame.id ?? `evt_${String(eventSequence).padStart(6, "0")}`,
		created: frame.created ?? nextTime(),
		type,
		data: { sessionID: SESSION_ID, ...data },
	})!;
}

export const streamReconnected: OpenCodeServerEvent = {
	type: STREAM_RECONNECTED_EVENT_TYPE,
	data: {},
	sessionId: undefined,
};

export type Deferred<T> = {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
};

export function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Lets every promise chain already settled run to its end (no timers involved). */
export const settleMicrotasks = async () => {
	for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
};

/** `message.list` over a transcript: newest first, `cursor.next` going older. */
export function messagePage(
	transcript: Transcript,
	{
		limit = 50,
		cursor,
	}: { readonly limit?: number | undefined; readonly cursor?: string | undefined },
): SessionMessagesResponse {
	const end = cursor === undefined ? transcript.length : Number(cursor);
	const start = Math.max(0, end - limit);
	return {
		data: transcript.slice(start, end).reverse(),
		cursor: start > 0 ? { next: String(start) } : {},
	};
}

type Client = OpenCodeClient;

/**
 * A v2 client whose calls are `vi.fn`s. Sessions and transcripts are served
 * from `sessions` and `transcripts` (an unknown session gets a default one).
 */
export function createFakeClient() {
	const sessions = new Map<string, SessionInfo>();
	const transcripts = new Map<string, Transcript>();
	const fake = {
		session: {
			get: vi.fn<Client["session"]["get"]>(
				async ({ sessionID }) => sessions.get(sessionID) ?? session(sessionID),
			),
			list: vi.fn<Client["session"]["list"]>(async () => ({ data: [], cursor: {} })),
			update: vi.fn<Client["session"]["update"]>(async () => undefined),
			remove: vi.fn<Client["session"]["remove"]>(async () => undefined),
			active: vi.fn<Client["session"]["active"]>(async () => ({})),
			prompt: vi.fn<Client["session"]["prompt"]>(async () => ({}) as never),
			switchAgent: vi.fn<Client["session"]["switchAgent"]>(async () => undefined),
			switchModel: vi.fn<Client["session"]["switchModel"]>(async () => undefined),
			interrupt: vi.fn<Client["session"]["interrupt"]>(async () => ({ interrupted: true })),
			fork: vi.fn<Client["session"]["fork"]>(async ({ sessionID }) => session(`${sessionID}_fork`)),
			revert: {
				stage: vi.fn<Client["session"]["revert"]["stage"]>(async ({ messageID }) => ({
					messageID,
				})),
				clear: vi.fn<Client["session"]["revert"]["clear"]>(async () => undefined),
			},
			form: {
				list: vi.fn<Client["session"]["form"]["list"]>(async () => []),
				get: vi.fn<Client["session"]["form"]["get"]>(async () => {
					throw new Error("No such form");
				}),
				reply: vi.fn<Client["session"]["form"]["reply"]>(async () => undefined),
				cancel: vi.fn<Client["session"]["form"]["cancel"]>(async () => undefined),
			},
		},
		message: {
			list: vi.fn<Client["message"]["list"]>(async (input) =>
				messagePage(transcripts.get(input.sessionID) ?? [], input),
			),
		},
		permission: {
			list: vi.fn<Client["permission"]["list"]>(async () => []),
			reply: vi.fn<Client["permission"]["reply"]>(async () => undefined),
		},
	};
	return {
		...fake,
		sessions,
		transcripts,
		/** The fake as the client the fork takes. */
		client: fake as unknown as OpenCodeClient,
	};
}

export type FakeClient = ReturnType<typeof createFakeClient>;

type Listener = (event: OpenCodeServerEvent) => void;

/** The shared stream: delivers to listeners live, as `OpenCodeEventSource` does. */
export function createFakeEventSource() {
	const listeners = new Set<Listener>();
	const unsubscribe = vi.fn();
	return {
		listeners,
		subscribe: vi.fn((listener: Listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				unsubscribe();
			};
		}),
		unsubscribe,
		emit(event: OpenCodeServerEvent) {
			for (const listener of listeners) listener(event);
		},
	};
}

export type FakeEventSource = ReturnType<typeof createFakeEventSource>;
