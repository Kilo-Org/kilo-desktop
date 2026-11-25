import type {
	OpenCodeEvent,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageInfo,
} from "@kilocode/client";

import type {
	KiloAssistantContent,
	KiloToolCall,
	OpenCodeInboxEntry,
	OpenCodeServerMessage,
} from "./types";

/*
 * Kilo v2's transcript as the event stream builds it, the way Kilo's own
 * clients fold it (`packages/client/src/solid/data.ts` upstream): the same
 * `SessionMessageInfo` rows `message.list` returns, so a streamed turn and the
 * history loaded after it are the same transcript.
 *
 * - A prompt or hidden note waits in the inbox (`session.inbox.enqueued`
 *   carries it) and enters the transcript when delivered, under its inbox id.
 * - An assistant message is one step: `session.step.started` … `.ended` /
 *   `.failed`, its content streaming in as text, reasoning and tool calls.
 *   Text and reasoning events name their item by `ordinal` (its place among
 *   the step's items of that kind), tool events by call id.
 * - Messages an event starts (shell runs, skills, notes, markers, a turn's
 *   idle marker) are named after the event (`evt_…` → `msg_…`), as the server
 *   names them in the history.
 *
 * Every fold returns the transcript it was given when the event changes
 * nothing, and copies only what it changes, so identity marks change.
 */

export type KiloTranscript = {
	readonly messageOrder: readonly string[];
	readonly messagesById: Readonly<Record<string, OpenCodeServerMessage>>;
	readonly inbox: Readonly<Record<string, OpenCodeInboxEntry>>;
};

type Assistant = SessionMessageAssistant;

/** A message an event starts is named after it, as Kilo v2's history names it. */
export const messageIdFromEvent = (eventId: string) => eventId.replace(/^evt_/, "msg_");

const eventMessageId = (event: { id?: string; type: string; created?: number }) =>
	event.id ? messageIdFromEvent(event.id) : `msg_${event.type}_${event.created ?? 0}`;

const eventCreated = (event: OpenCodeEvent) =>
	"created" in event && typeof event.created === "number" ? event.created : Date.now();

/** Adds a message at the end, or replaces the one with its id where it stands. */
const put = (transcript: KiloTranscript, message: SessionMessageInfo): KiloTranscript => {
	const known = message.id in transcript.messagesById;
	return {
		...transcript,
		messagesById: { ...transcript.messagesById, [message.id]: message },
		messageOrder: known ? transcript.messageOrder : [...transcript.messageOrder, message.id],
	};
};

const editMessage = <T extends SessionMessageInfo>(
	transcript: KiloTranscript,
	id: string,
	is: (message: SessionMessageInfo) => message is T,
	edit: (message: T) => T | undefined,
): KiloTranscript => {
	const current = transcript.messagesById[id];
	if (!current || !is(current)) return transcript;
	const next = edit(current);
	if (!next || next === current) return transcript;
	return { ...transcript, messagesById: { ...transcript.messagesById, [id]: next } };
};

const isAssistant = (message: SessionMessageInfo): message is Assistant =>
	message.type === "assistant";

const editAssistant = (
	transcript: KiloTranscript,
	id: string,
	edit: (message: Assistant) => Assistant | undefined,
) => editMessage(transcript, id, isAssistant, edit);

/** Index of the `ordinal`-th content item of `type` (-1 when the step has fewer). */
const nthIndex = (
	content: readonly KiloAssistantContent[],
	type: "text" | "reasoning",
	ordinal: number,
) => {
	let seen = -1;
	for (const [index, item] of content.entries()) {
		if (item.type === type && ++seen === ordinal) return index;
	}
	return -1;
};

const withContent = (message: Assistant, index: number, item: KiloAssistantContent): Assistant => {
	const content = [...message.content];
	if (index < 0) content.push(item);
	else content[index] = item;
	return { ...message, content };
};

const editText = (
	transcript: KiloTranscript,
	messageId: string,
	ordinal: number,
	edit: (text: string) => string,
) =>
	editAssistant(transcript, messageId, (message) => {
		const index = nthIndex(message.content, "text", ordinal);
		const current = index < 0 ? undefined : message.content[index];
		const text = edit(current?.type === "text" ? current.text : "");
		return withContent(message, index, { ...(current ?? {}), type: "text", text });
	});

const editTool = (
	transcript: KiloTranscript,
	messageId: string,
	callId: string,
	edit: (tool: KiloToolCall | undefined) => KiloToolCall | undefined,
) =>
	editAssistant(transcript, messageId, (message) => {
		const index = message.content.findLastIndex(
			(item) => item.type === "tool" && item.id === callId,
		);
		const current = index < 0 ? undefined : (message.content[index] as KiloToolCall);
		const next = edit(current);
		return next ? withContent(message, index, next) : undefined;
	});

const activeAssistantId = (transcript: KiloTranscript) =>
	transcript.messageOrder.findLast((id) => {
		const message = transcript.messagesById[id];
		return message?.type === "assistant" && message.time.completed === undefined;
	});

const lastRunningId = (transcript: KiloTranscript, type: "compaction" | "shell", match = "") =>
	transcript.messageOrder.findLast((id) => {
		const message = transcript.messagesById[id];
		if (message?.type === "compaction")
			return type === "compaction" && message.status === "running";
		return type === "shell" && message?.type === "shell" && message.shellID === match;
	});

const withoutInbox = (transcript: KiloTranscript, inboxId: string | undefined): KiloTranscript => {
	if (!inboxId || !(inboxId in transcript.inbox)) return transcript;
	const { [inboxId]: _removed, ...inbox } = transcript.inbox;
	return { ...transcript, inbox };
};

/**
 * The object without its undefined fields: Kilo v2's types leave optional
 * fields out rather than undefined. Typed by where it goes.
 */
const defined = <T>(value: object): T =>
	Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/** A delivered inbox item as the transcript message it becomes. */
const deliveredMessage = (
	id: string,
	entry: OpenCodeInboxEntry,
	created: number,
): SessionMessageInfo | undefined => {
	const { item } = entry;
	if (item.type === "user") {
		const { text, files, agents, skills, metadata } = item.payload;
		return defined({ id, type: "user", text, files, agents, skills, metadata, time: { created } });
	}
	if (item.type === "synthetic") {
		const { text, description, metadata } = item.payload;
		return defined({ id, type: "synthetic", text, description, metadata, time: { created } });
	}
	return undefined;
};

/** The transcript with the event folded in; the same object when it changes nothing. */
export function foldKiloEvent(transcript: KiloTranscript, event: OpenCodeEvent): KiloTranscript {
	const created = eventCreated(event);
	switch (event.type) {
		case "session.inbox.enqueued":
			return {
				...transcript,
				inbox: { ...transcript.inbox, [event.data.inboxID]: { item: event.data.item, created } },
			};
		case "session.inbox.cancelled":
			return withoutInbox(transcript, event.data.inboxID);
		case "session.inbox.delivered": {
			const entry = transcript.inbox[event.data.inboxID];
			if (!entry) return transcript;
			const message = deliveredMessage(event.data.inboxID, entry, created);
			const next = withoutInbox(transcript, event.data.inboxID);
			return message ? put(next, message) : next;
		}
		case "session.synthetic":
			return put(
				transcript,
				defined({
					id: eventMessageId(event),
					type: "synthetic",
					text: event.data.text,
					description: event.data.description,
					metadata: event.data.metadata,
					time: { created },
				}),
			);
		case "session.instructions.updated":
			if (event.data.text === undefined) return transcript;
			return put(transcript, {
				id: eventMessageId(event),
				type: "system",
				text: event.data.text,
				description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
				time: { created },
			});
		case "session.skill.activated":
			return put(transcript, {
				id: eventMessageId(event),
				type: "skill",
				skill: event.data.id,
				name: event.data.name,
				text: event.data.text,
				time: { created },
			});
		case "session.agent.selected":
			return put(transcript, {
				id: eventMessageId(event),
				type: "agent-switched",
				agent: event.data.agent,
				time: { created },
			});
		case "session.model.selected":
			return put(
				transcript,
				defined({
					id: eventMessageId(event),
					type: "model-switched",
					model: event.data.model,
					previous: event.data.previous,
					time: { created },
				}),
			);
		case "session.moved":
			return put(
				transcript,
				defined({
					id: eventMessageId(event),
					type: "location-switched",
					location: event.data.location,
					projectID: event.data.projectID,
					subpath: event.data.subpath,
					time: { created },
				}),
			);
		case "session.shell.started":
			return put(
				transcript,
				defined({
					id: eventMessageId(event),
					type: "shell",
					shellID: event.data.shell.id,
					command: event.data.shell.command,
					status: event.data.shell.status,
					exit: event.data.shell.exit,
					time: { created },
				}),
			);
		case "session.shell.ended": {
			const { shell, output } = event.data;
			const id = lastRunningId(transcript, "shell", shell.id);
			if (!id) {
				return put(
					transcript,
					defined({
						id: eventMessageId(event),
						type: "shell",
						shellID: shell.id,
						command: shell.command,
						status: shell.status,
						exit: shell.exit,
						output,
						time: { created: shell.time.started, completed: created },
					}),
				);
			}
			return editMessage(
				transcript,
				id,
				(message) => message.type === "shell",
				(message) =>
					defined({
						...message,
						status: shell.status,
						exit: shell.exit,
						output,
						time: { ...message.time, completed: created },
					}),
			);
		}

		case "session.step.started": {
			const { assistantMessageID: id, agent, model, snapshot, started } = event.data;
			const existing = transcript.messagesById[id];
			if (existing?.type === "assistant") {
				return editAssistant(transcript, id, (message) =>
					defined({
						...message,
						agent,
						model,
						retry: undefined,
						error: undefined,
						finish: undefined,
						rawFinish: undefined,
						native: undefined,
						time: { created: started },
						snapshot: snapshot ? { ...message.snapshot, start: snapshot } : message.snapshot,
					}),
				);
			}
			const active = activeAssistantId(transcript);
			const closed = active
				? editAssistant(transcript, active, (message) =>
						defined({
							...message,
							retry: undefined,
							time: { ...message.time, completed: created },
						}),
					)
				: transcript;
			return put(
				closed,
				defined({
					id,
					type: "assistant",
					agent,
					model,
					content: [],
					snapshot: snapshot ? { start: snapshot } : undefined,
					time: { created: started },
				}),
			);
		}
		case "session.step.first-token":
			return editAssistant(transcript, event.data.assistantMessageID, (message) => ({
				...message,
				time: { ...message.time, firstToken: created },
			}));
		case "session.step.streamed":
			return editAssistant(transcript, event.data.assistantMessageID, (message) => ({
				...message,
				time: { ...message.time, streamed: created },
			}));
		case "session.step.ended": {
			const { finish, rawFinish, cost, tokens, snapshot, files } = event.data;
			return editAssistant(transcript, event.data.assistantMessageID, (message) =>
				defined({
					...message,
					time: { ...message.time, completed: created },
					finish,
					rawFinish,
					cost,
					tokens,
					snapshot:
						snapshot || files
							? defined({ ...message.snapshot, end: snapshot, files })
							: message.snapshot,
				}),
			);
		}
		case "session.step.failed": {
			const { finish, rawFinish, error, cost, tokens, snapshot, files } = event.data;
			return editAssistant(transcript, event.data.assistantMessageID, (message) =>
				defined({
					...message,
					time: { ...message.time, completed: created },
					finish: finish ?? "error",
					rawFinish,
					error,
					retry: undefined,
					...(cost !== undefined && tokens !== undefined ? { cost, tokens } : {}),
					snapshot:
						snapshot || files
							? defined({ ...message.snapshot, end: snapshot, files })
							: message.snapshot,
				}),
			);
		}
		case "session.retry.scheduled":
			return editAssistant(transcript, event.data.assistantMessageID, (message) => ({
				...message,
				retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
			}));

		case "session.text.started":
			return editAssistant(transcript, event.data.assistantMessageID, (message) =>
				nthIndex(message.content, "text", event.data.ordinal) < 0
					? { ...message, content: [...message.content, { type: "text", text: "" }] }
					: undefined,
			);
		case "session.text.delta":
			return editText(
				transcript,
				event.data.assistantMessageID,
				event.data.ordinal,
				(text) => text + event.data.delta,
			);
		case "session.text.ended":
			return editText(
				transcript,
				event.data.assistantMessageID,
				event.data.ordinal,
				() => event.data.text,
			);
		case "session.reasoning.started":
			return editAssistant(transcript, event.data.assistantMessageID, (message) =>
				nthIndex(message.content, "reasoning", event.data.ordinal) < 0
					? {
							...message,
							content: [
								...message.content,
								defined({
									type: "reasoning" as const,
									text: "",
									native: event.data.native,
									time: { created },
								}),
							],
						}
					: undefined,
			);
		case "session.reasoning.delta":
		case "session.reasoning.ended":
			return editAssistant(transcript, event.data.assistantMessageID, (message) => {
				const index = nthIndex(message.content, "reasoning", event.data.ordinal);
				const current = index < 0 ? undefined : message.content[index];
				const reasoning =
					current?.type === "reasoning"
						? current
						: { type: "reasoning" as const, text: "", time: { created } };
				if (event.type === "session.reasoning.delta") {
					return withContent(message, index, {
						...reasoning,
						text: reasoning.text + event.data.delta,
					});
				}
				return withContent(
					message,
					index,
					defined({
						...reasoning,
						text: event.data.text,
						native: event.data.native ?? reasoning.native,
						time: { created: reasoning.time?.created ?? created, completed: created },
					}),
				);
			});

		case "session.tool.input.started":
			return editTool(transcript, event.data.assistantMessageID, event.data.id, (tool) =>
				tool
					? undefined
					: {
							type: "tool",
							id: event.data.id,
							name: event.data.name,
							time: { created },
							state: { status: "streaming", input: "" },
						},
			);
		case "session.tool.input.delta":
		case "session.tool.input.ended":
			return editTool(transcript, event.data.assistantMessageID, event.data.id, (tool) => {
				if (tool?.state.status !== "streaming") return undefined;
				const input =
					event.type === "session.tool.input.delta"
						? tool.state.input + event.data.delta
						: event.data.text;
				return { ...tool, state: { status: "streaming", input } };
			});
		case "session.tool.called":
			return editTool(transcript, event.data.assistantMessageID, event.data.id, (tool) =>
				defined({
					type: "tool" as const,
					id: event.data.id,
					name: tool?.name ?? "",
					...tool,
					executed: event.data.executed,
					native: event.data.native ?? tool?.native,
					time: { ...(tool?.time ?? { created }), ran: created },
					state: { status: "running" as const, input: event.data.input, metadata: {} },
				}),
			);
		case "session.tool.progress":
			return editTool(transcript, event.data.assistantMessageID, event.data.id, (tool) =>
				tool?.state.status === "running"
					? { ...tool, state: { ...tool.state, metadata: event.data.metadata } }
					: undefined,
			);
		case "session.tool.success":
			return editTool(transcript, event.data.assistantMessageID, event.data.id, (tool) => {
				if (tool?.state.status !== "running") return undefined;
				return {
					...tool,
					executed: event.data.executed || tool.executed === true,
					time: { ...tool.time, completed: created },
					state: defined({
						status: "completed" as const,
						input: tool.state.input,
						content: event.data.content,
						metadata: event.data.metadata,
					}),
				};
			});
		case "session.tool.failed":
			return editTool(transcript, event.data.assistantMessageID, event.data.id, (tool) => {
				if (!tool || (tool.state.status !== "streaming" && tool.state.status !== "running")) {
					return undefined;
				}
				return {
					...tool,
					executed: event.data.executed || tool.executed === true,
					time: { ...tool.time, completed: created },
					state: defined({
						status: "error" as const,
						input: typeof tool.state.input === "string" ? {} : tool.state.input,
						error: event.data.error,
						content: event.data.content,
						metadata: event.data.metadata,
					}),
				};
			});
		case "session.compaction.started": {
			const next = withoutInbox(transcript, event.data.inputID);
			return put(next, {
				id: event.data.inputID ?? eventMessageId(event),
				type: "compaction",
				status: "running",
				reason: event.data.reason,
				summary: "",
				time: { created },
			});
		}
		case "session.compaction.delta": {
			const id = lastRunningId(transcript, "compaction");
			if (!id) return transcript;
			return editMessage(
				transcript,
				id,
				(message) => message.type === "compaction" && message.status === "running",
				(message) => ({ ...message, summary: message.summary + event.data.text }),
			);
		}
		case "session.compaction.ended": {
			const id = lastRunningId(transcript, "compaction");
			const current = id ? transcript.messagesById[id] : undefined;
			return put(
				transcript,
				defined({
					id: id ?? eventMessageId(event),
					type: "compaction",
					status: "completed",
					reason: event.data.reason,
					model: event.data.model,
					summary: event.data.text,
					cost: event.data.cost,
					tokens: event.data.tokens,
					time: current?.time ?? { created },
				}) as SessionMessageInfo,
			);
		}
		case "session.compaction.failed": {
			const id = lastRunningId(transcript, "compaction");
			const current = id ? transcript.messagesById[id] : undefined;
			return put(
				withoutInbox(transcript, event.data.inputID),
				defined({
					id: id ?? event.data.inputID ?? eventMessageId(event),
					type: "compaction",
					status: "failed",
					reason: event.data.reason,
					error: event.data.error,
					cost: event.data.cost,
					tokens: event.data.tokens,
					time: current?.time ?? { created },
				}) as SessionMessageInfo,
			);
		}

		case "session.execution.succeeded":
		case "session.execution.failed":
		case "session.execution.interrupted": {
			const active = activeAssistantId(transcript);
			const cleared = active
				? editAssistant(transcript, active, (message) =>
						message.retry ? defined({ ...message, retry: undefined }) : undefined,
					)
				: transcript;
			if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") {
				return cleared;
			}
			return put(
				cleared,
				defined({
					id: eventMessageId(event),
					type: "idle",
					outcome:
						event.type === "session.execution.succeeded"
							? "succeeded"
							: event.type === "session.execution.failed"
								? "failed"
								: "interrupted",
					error: event.type === "session.execution.failed" ? event.data.error : undefined,
					time: { created },
				}) as SessionMessageInfo,
			);
		}
		case "session.revert.committed": {
			const { to } = event.data;
			const at = transcript.messageOrder.indexOf(to);
			const cut = at >= 0 ? at : transcript.messageOrder.findIndex((id) => id >= to);
			const inbox = Object.fromEntries(Object.entries(transcript.inbox).filter(([id]) => id < to));
			if (cut < 0) return { ...transcript, inbox };
			const messagesById = { ...transcript.messagesById };
			for (const id of transcript.messageOrder.slice(cut)) delete messagesById[id];
			return { messageOrder: transcript.messageOrder.slice(0, cut), messagesById, inbox };
		}
		default:
			return transcript;
	}
}

/** The session with the event's change applied; the same object when it changes nothing. */
export function foldKiloSessionEvent(
	session: SessionInfo | null,
	event: OpenCodeEvent,
): SessionInfo | null {
	if (!session) return session;
	const created = eventCreated(event);
	switch (event.type) {
		case "session.renamed":
			return { ...session, title: event.data.title };
		case "session.metadata.updated":
			return { ...session, metadata: event.data.metadata };
		case "session.permissions":
			return { ...session, permissions: event.data.permissions };
		case "session.archived":
			return { ...session, time: { ...session.time, archived: created } };
		case "session.unarchived": {
			const { archived: _archived, ...time } = session.time;
			return { ...session, time };
		}
		case "session.usage.updated":
			return { ...session, cost: event.data.cost, tokens: event.data.tokens };
		case "session.agent.selected":
			return { ...session, agent: event.data.agent };
		case "session.model.selected":
			return { ...session, model: event.data.model };
		case "session.moved":
			return defined({
				...session,
				location: event.data.location,
				projectID: event.data.projectID,
				subpath: event.data.subpath,
			});
		case "session.revert.staged":
			return { ...session, revert: event.data.revert };
		case "session.revert.cleared":
		case "session.revert.committed": {
			if (!session.revert) return session;
			const { revert: _revert, ...rest } = session;
			return rest;
		}
		default:
			return session;
	}
}

/** The assistant message (and step) a streaming event writes to, when it names one. */
export function streamedAssistantId(event: OpenCodeEvent): string | undefined {
	const data = event.data as { assistantMessageID?: unknown } | undefined;
	return event.type !== "session.step.started" && typeof data?.assistantMessageID === "string"
		? data.assistantMessageID
		: undefined;
}
