// Folds a Kilo v2 session's events into its messages, as kilo2's own client
// does (`packages/client/src/solid/data.ts` on kilocode `v2`), so a transcript
// built from the stream matches the one `message.list` serves.
//
// Reducers never mutate: every change replaces the message (and the array)
// it touches, so identity is a sound cache key for the projection. Streaming
// events address the latest part of a kind in one assistant message (text and
// reasoning by recency, tools by call id); an event for a message that isn't
// loaded is dropped, as kilo2's client drops it.
import type {
	SessionMessageAssistant,
	SessionMessageAssistantReasoning,
	SessionMessageAssistantText,
	SessionMessageAssistantTool,
	SessionMessageInfo,
} from "@kilocode/client";

/** A v2 event as the stream delivers it (`/api/event` frame). */
export interface KiloEventFrame {
	readonly id?: string | undefined;
	readonly type: string;
	readonly created?: number | undefined;
	readonly data: Readonly<Record<string, unknown>>;
	readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export type Transcript = readonly SessionMessageInfo[];

type Assistant = SessionMessageAssistant;
type Content = Assistant["content"][number];

/** A message id derived from its event's id, as kilo2's projector derives it. */
export const messageIdFromEvent = (eventId: string | undefined): string =>
	eventId ? eventId.replace(/^evt_/, "msg_") : `msg_local_${Date.now().toString(36)}`;

const data = <T>(event: KiloEventFrame) => event.data as unknown as T;

const now = (event: KiloEventFrame) => event.created ?? Date.now();

function replaceAt(messages: Transcript, index: number, next: SessionMessageInfo): Transcript {
	const copy = messages.slice();
	copy[index] = next;
	return copy;
}

const findIndex = (messages: Transcript, id: string): number => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]!.id === id) return index;
	}
	return -1;
};

function editAssistant(
	messages: Transcript,
	messageId: unknown,
	edit: (assistant: Assistant) => Assistant | undefined,
): Transcript {
	if (typeof messageId !== "string") return messages;
	const index = findIndex(messages, messageId);
	const current = messages[index];
	if (current?.type !== "assistant") return messages;
	const next = edit(current);
	return next && next !== current ? replaceAt(messages, index, next) : messages;
}

/** Replaces the last content item matching `match` with `edit(item)`. */
function editContent<T extends Content>(
	assistant: Assistant,
	match: (item: Content) => item is T,
	edit: (item: T) => T | undefined,
): Assistant | undefined {
	for (let index = assistant.content.length - 1; index >= 0; index -= 1) {
		const item = assistant.content[index]!;
		if (!match(item)) continue;
		const next = edit(item);
		if (!next) return undefined;
		const content = assistant.content.slice();
		content[index] = next;
		return { ...assistant, content };
	}
	return undefined;
}

const isText = (item: Content): item is SessionMessageAssistantText => item.type === "text";
const isOpenReasoning = (item: Content): item is SessionMessageAssistantReasoning =>
	item.type === "reasoning" && !item.time?.completed;
const isTool =
	(id: unknown) =>
	(item: Content): item is SessionMessageAssistantTool =>
		item.type === "tool" && item.id === id;

const append = (messages: Transcript, message: SessionMessageInfo): Transcript =>
	findIndex(messages, message.id) >= 0 ? messages : [...messages, message];

/** The step still streaming, if any. */
const activeAssistantIndex = (messages: Transcript): number => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.type === "assistant" && !message.time.completed) return index;
	}
	return -1;
};

const withoutRetry = (messages: Transcript): Transcript => {
	const index = activeAssistantIndex(messages);
	const current = messages[index];
	if (current?.type !== "assistant" || !current.retry) return messages;
	const { retry: _retry, ...rest } = current;
	return replaceAt(messages, index, rest);
};

/** An item admitted to the session's inbox (`session.inbox.enqueued`). */
export interface InboxItem {
	readonly id: string;
	readonly type: string;
	readonly payload: Readonly<Record<string, unknown>>;
	readonly created: number;
}

/**
 * The inbox item an `session.inbox.enqueued` event admits, as a transcript
 * message (prompts and synthetic notes; compactions get their own message).
 */
export function inboxMessage(item: InboxItem): SessionMessageInfo | undefined {
	if (item.type !== "user" && item.type !== "synthetic") return undefined;
	const { selection: _selection, ...payload } = item.payload as Record<string, unknown>;
	return {
		id: item.id,
		type: item.type,
		...payload,
		time: { created: item.created },
	} as SessionMessageInfo;
}

/** One event applied to a session's transcript; the same array back when it changes nothing. */
export function applyTranscriptEvent(messages: Transcript, event: KiloEventFrame): Transcript {
	switch (event.type) {
		case "session.inbox.enqueued": {
			const { inboxID, item } = data<{
				inboxID: string;
				item: { type: string; payload: Record<string, unknown> };
			}>(event);
			const message = inboxMessage({ id: inboxID, ...item, created: now(event) });
			if (!message) return messages;
			const index = findIndex(messages, inboxID);
			return index < 0 ? [...messages, message] : replaceAt(messages, index, message);
		}
		case "session.inbox.delivered": {
			const { inboxID } = data<{ inboxID: string }>(event);
			const index = findIndex(messages, inboxID);
			const current = messages[index];
			if (!current) return messages;
			// Delivered prompts join the transcript where the runner took them.
			const moved = {
				...current,
				time: { ...current.time, created: now(event) },
			} as SessionMessageInfo;
			return [...messages.slice(0, index), ...messages.slice(index + 1), moved];
		}
		case "session.inbox.cancelled": {
			const { inboxID } = data<{ inboxID: string }>(event);
			const index = findIndex(messages, inboxID);
			return index < 0 ? messages : [...messages.slice(0, index), ...messages.slice(index + 1)];
		}
		case "session.synthetic": {
			const { text, description } = data<{ text: string; description?: string }>(event);
			return append(messages, {
				id: messageIdFromEvent(event.id),
				type: "synthetic",
				text,
				...(description !== undefined ? { description } : {}),
				...(event.metadata ? { metadata: event.metadata as never } : {}),
				time: { created: now(event) },
			});
		}
		case "session.instructions.updated": {
			const { text, delta } = data<{ text?: string; delta?: Record<string, unknown> }>(event);
			if (text === undefined) return messages;
			return append(messages, {
				id: messageIdFromEvent(event.id),
				type: "system",
				text,
				description: `Instructions updated: ${Object.keys(delta ?? {}).join(", ")}`,
				...(event.metadata ? { metadata: event.metadata as never } : {}),
				time: { created: now(event) },
			});
		}
		case "session.shell.started": {
			const { shell } = data<{
				shell: {
					id: string;
					command: string;
					status: string;
					exit?: number;
					metadata?: Record<string, unknown>;
				};
			}>(event);
			return append(messages, {
				id: messageIdFromEvent(event.id),
				type: "shell",
				shellID: shell.id,
				command: shell.command,
				status: shell.status as never,
				...(shell.exit !== undefined ? { exit: shell.exit } : {}),
				...(shell.metadata?.background === true
					? { metadata: { ...event.metadata, background: true } as never }
					: event.metadata
						? { metadata: event.metadata as never }
						: {}),
				time: { created: now(event) },
			});
		}
		case "session.shell.ended": {
			const { shell, output } = data<{
				shell: { id: string; status: string; exit?: number };
				output?: unknown;
			}>(event);
			for (let index = messages.length - 1; index >= 0; index -= 1) {
				const message = messages[index]!;
				if (message.type !== "shell" || message.shellID !== shell.id) continue;
				return replaceAt(messages, index, {
					...message,
					status: shell.status as never,
					...(shell.exit !== undefined ? { exit: shell.exit } : {}),
					...(output !== undefined ? { output: output as never } : {}),
					time: { ...message.time, completed: now(event) },
				});
			}
			return messages;
		}
		case "session.step.started": {
			const step = data<{
				assistantMessageID: string;
				agent: string;
				model: Assistant["model"];
				started: number;
				snapshot?: string;
			}>(event);
			const index = findIndex(messages, step.assistantMessageID);
			const existing = messages[index];
			if (existing?.type === "assistant") {
				// A retried step starts over in the same message.
				const {
					retry: _retry,
					error: _error,
					finish: _finish,
					rawFinish: _rawFinish,
					native: _native,
					...rest
				} = existing;
				return replaceAt(messages, index, {
					...rest,
					agent: step.agent,
					model: step.model,
					time: { created: step.started },
					...(step.snapshot ? { snapshot: { ...existing.snapshot, start: step.snapshot } } : {}),
				});
			}
			let next = messages;
			const activeIndex = activeAssistantIndex(next);
			const active = next[activeIndex];
			if (active?.type === "assistant") {
				const { retry: _retry, ...rest } = active;
				next = replaceAt(next, activeIndex, {
					...rest,
					time: { ...active.time, completed: now(event) },
				});
			}
			return [
				...next,
				{
					id: step.assistantMessageID,
					type: "assistant",
					agent: step.agent,
					model: step.model,
					...(event.metadata ? { metadata: event.metadata as never } : {}),
					content: [],
					...(step.snapshot ? { snapshot: { start: step.snapshot } } : {}),
					time: { created: step.started },
				},
			];
		}
		case "session.step.first-token":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				time: { ...assistant.time, firstToken: now(event) },
			}));
		case "session.step.streamed":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				time: { ...assistant.time, streamed: now(event) },
			}));
		case "session.step.ended": {
			const ended = data<{
				finish: Assistant["finish"];
				rawFinish?: string;
				native?: Assistant["native"];
				cost?: number;
				tokens?: Assistant["tokens"];
				snapshot?: string;
			}>(event);
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				...(ended.finish !== undefined ? { finish: ended.finish } : {}),
				...(ended.rawFinish !== undefined ? { rawFinish: ended.rawFinish } : {}),
				...(ended.native !== undefined ? { native: ended.native } : {}),
				...(ended.cost !== undefined ? { cost: ended.cost } : {}),
				...(ended.tokens !== undefined ? { tokens: ended.tokens } : {}),
				...(ended.snapshot ? { snapshot: { ...assistant.snapshot, end: ended.snapshot } } : {}),
				time: { ...assistant.time, completed: now(event) },
			}));
		}
		case "session.step.failed": {
			const failed = data<{
				error: NonNullable<Assistant["error"]>;
				finish?: Assistant["finish"];
				rawFinish?: string;
				native?: Assistant["native"];
				cost?: number;
				tokens?: Assistant["tokens"];
			}>(event);
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => {
				const { retry: _retry, ...rest } = assistant;
				const finish: NonNullable<Assistant["finish"]> = failed.finish ?? "error";
				return {
					...rest,
					finish,
					...(failed.rawFinish !== undefined ? { rawFinish: failed.rawFinish } : {}),
					...(failed.native !== undefined ? { native: failed.native } : {}),
					error: failed.error,
					...(failed.cost !== undefined && failed.tokens !== undefined
						? { cost: failed.cost, tokens: failed.tokens }
						: {}),
					time: { ...assistant.time, completed: now(event) },
				};
			});
		}
		case "session.retry.scheduled": {
			const retry = data<{ attempt: number; at: number; error: unknown }>(event);
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				retry: { attempt: retry.attempt, at: retry.at, error: retry.error } as never,
			}));
		}
		case "session.text.started":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				content: [...assistant.content, { type: "text", text: "" }],
			}));
		case "session.text.delta":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isText, (text) => ({
					...text,
					text: text.text + String(event.data.delta ?? ""),
				})),
			);
		case "session.text.ended":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isText, (text) => ({
					...text,
					text: String(event.data.text ?? ""),
					...(event.data.native !== undefined ? { native: event.data.native as never } : {}),
				})),
			);
		case "session.reasoning.started":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				content: [
					...assistant.content,
					{
						type: "reasoning",
						text: "",
						...(event.data.native !== undefined ? { native: event.data.native as never } : {}),
						time: { created: now(event) },
					},
				],
			}));
		case "session.reasoning.delta":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isOpenReasoning, (reasoning) => ({
					...reasoning,
					text: reasoning.text + String(event.data.delta ?? ""),
				})),
			);
		case "session.reasoning.ended":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isOpenReasoning, (reasoning) => ({
					...reasoning,
					text: String(event.data.text ?? ""),
					...(event.data.native !== undefined ? { native: event.data.native as never } : {}),
					time: { created: reasoning.time?.created ?? now(event), completed: now(event) },
				})),
			);
		case "session.tool.input.started":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) => ({
				...assistant,
				content: [
					...assistant.content,
					{
						type: "tool",
						id: String(event.data.id),
						name: String(event.data.name),
						time: { created: now(event) },
						state: { status: "streaming", input: "" },
					},
				],
			}));
		case "session.tool.input.delta":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isTool(event.data.id), (tool) =>
					tool.state.status === "streaming"
						? {
								...tool,
								state: { ...tool.state, input: tool.state.input + String(event.data.delta ?? "") },
							}
						: undefined,
				),
			);
		case "session.tool.input.ended":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isTool(event.data.id), (tool) =>
					tool.state.status === "streaming"
						? { ...tool, state: { ...tool.state, input: String(event.data.text ?? "") } }
						: undefined,
				),
			);
		case "session.tool.called":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isTool(event.data.id), (tool) => ({
					...tool,
					...(event.data.executed !== undefined
						? { executed: event.data.executed as boolean }
						: {}),
					...(event.data.native !== undefined ? { native: event.data.native as never } : {}),
					time: { ...tool.time, ran: now(event) },
					state: { status: "running", input: event.data.input as never, metadata: {} },
				})),
			);
		case "session.tool.progress":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isTool(event.data.id), (tool) =>
					tool.state.status === "running"
						? { ...tool, state: { ...tool.state, metadata: event.data.metadata as never } }
						: undefined,
				),
			);
		case "session.tool.success":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isTool(event.data.id), (tool) => {
					if (tool.state.status !== "running") return undefined;
					return {
						...tool,
						executed: event.data.executed === true || tool.executed === true,
						...(event.data.native !== undefined
							? { native: { ...tool.native, ...(event.data.native as object) } as never }
							: {}),
						time: { ...tool.time, completed: now(event) },
						state: {
							status: "completed",
							input: tool.state.input,
							metadata: event.data.metadata as never,
							content: event.data.content as never,
						},
					};
				}),
			);
		case "session.tool.failed":
			return editAssistant(messages, event.data.assistantMessageID, (assistant) =>
				editContent(assistant, isTool(event.data.id), (tool) => {
					if (tool.state.status !== "streaming" && tool.state.status !== "running")
						return undefined;
					return {
						...tool,
						executed: event.data.executed === true || tool.executed === true,
						time: { ...tool.time, completed: now(event) },
						state: {
							status: "error",
							error: event.data.error as never,
							input: typeof tool.state.input === "string" ? ({} as never) : tool.state.input,
							...(event.data.metadata !== undefined
								? { metadata: event.data.metadata as never }
								: {}),
							...(event.data.content !== undefined ? { content: event.data.content as never } : {}),
						},
					};
				}),
			);
		case "session.execution.succeeded":
		case "session.execution.failed":
		case "session.execution.interrupted": {
			const settled = withoutRetry(messages);
			if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") {
				return settled;
			}
			const outcome =
				event.type === "session.execution.succeeded"
					? "succeeded"
					: event.type === "session.execution.failed"
						? "failed"
						: "interrupted";
			return append(settled, {
				id: messageIdFromEvent(event.id),
				type: "idle",
				outcome,
				...(event.type === "session.execution.failed" && event.data.error
					? { error: event.data.error as never }
					: {}),
				time: { created: now(event) },
			});
		}
		case "session.compaction.started": {
			const started = data<{ inputID?: string; reason: string }>(event);
			return append(messages, {
				id: started.inputID ?? messageIdFromEvent(event.id),
				type: "compaction",
				status: "running",
				reason: started.reason as never,
				summary: "",
				time: { created: now(event) },
			} as SessionMessageInfo);
		}
		case "session.compaction.delta": {
			for (let index = messages.length - 1; index >= 0; index -= 1) {
				const message = messages[index]!;
				if (message.type !== "compaction" || message.status !== "running") continue;
				return replaceAt(messages, index, {
					...message,
					summary: message.summary + String(event.data.text ?? ""),
				});
			}
			return messages;
		}
		case "session.compaction.ended":
		case "session.compaction.failed": {
			const ended = event.data as Record<string, unknown>;
			let index = -1;
			for (let at = messages.length - 1; at >= 0; at -= 1) {
				const message = messages[at]!;
				if (message.type === "compaction" && message.status === "running") {
					index = at;
					break;
				}
			}
			const current = messages[index];
			const base = {
				id:
					current?.id ??
					(typeof ended.inputID === "string" ? ended.inputID : messageIdFromEvent(event.id)),
				type: "compaction" as const,
				reason: ended.reason,
				...(ended.cost !== undefined ? { cost: ended.cost } : {}),
				...(ended.tokens !== undefined ? { tokens: ended.tokens } : {}),
				time: current?.time ?? { created: now(event) },
			};
			const next = (event.type === "session.compaction.ended"
				? {
						...base,
						status: "completed",
						...(ended.model !== undefined ? { model: ended.model } : {}),
						...(ended.native !== undefined ? { native: ended.native } : {}),
						summary: ended.text,
					}
				: { ...base, status: "failed", error: ended.error }) as unknown as SessionMessageInfo;
			return current ? replaceAt(messages, index, next) : [...messages, next];
		}
		case "session.revert.committed": {
			const { to } = data<{ to: string }>(event);
			let position = findIndex(messages, to);
			if (position < 0) position = messages.findIndex((message) => message.id >= to);
			return position < 0 ? messages : messages.slice(0, position);
		}
		default:
			return messages;
	}
}

/** Every event of `events` applied in order. */
export const applyTranscriptEvents = (
	messages: Transcript,
	events: readonly KiloEventFrame[],
): Transcript => events.reduce(applyTranscriptEvent, messages);
