import type { OpenCodeEvent, SessionInfo, SessionStructuredError } from "@kilocode/client";

import type { AssistantMessage, MessageWithParts, Part, ToolState, UserMessage } from "../types";
import {
	reasoningPartId,
	stepFinishPartId,
	stepStartPartId,
	textPartId,
	toolPartId,
	toV1AssistantInfo,
	toV1CompactionMessages,
	toV1ShellMessage,
	toV1Error,
	toV1FilePart,
	toV1Session,
	toV1ToolState,
	type V2Tool,
} from "./v2-messages";
import { toV1ToolInput, toV1ToolMetadata, toV1ToolName } from "./v2-tools";

/**
 * Kilo v2's event stream as the v1 events the thread controller reads
 * (`message.updated`, `message.part.updated`, `message.part.delta`,
 * `session.status`, `session.idle`, `session.error`, …), so the controller
 * and thread state stay as they were. Permissions and forms
 * (`permission.asked`/`.replied`, `form.created`/`.replied`/`.cancelled`)
 * pass through with Kilo v2's own data.
 *
 * v1 sent whole messages and parts; v2 sends small steps: a turn is
 * `session.execution.started` … `.succeeded`/`.failed`/`.interrupted`, an
 * assistant message is `session.step.started` … `.ended`, its content
 * streams as `session.text.*`, `session.reasoning.*` and
 * `session.tool.input.*` → `.called` → `.progress` → `.success`/`.failed`,
 * and a user or hidden message enters the transcript when its inbox item is
 * delivered (`session.inbox.enqueued` carries the text, `.delivered` the
 * moment). The translator keeps what each step has said so far, so every
 * v1 part it emits is whole; part ids match `v2-messages.ts`.
 *
 * Shell runs, skills and compactions become whole v1 messages, with the ids
 * v2's history gives them (the starting event's id, `evt_` → `msg_`). Revert
 * changes re-read the session, which carries the revert.
 */

export type V1Event = {
	readonly type: string;
	readonly properties: Record<string, unknown>;
	readonly directory?: string | undefined;
};

/** Reads a session again (for v1's whole-session events); undefined when it is gone. */
export type ReadSession = (sessionID: string) => Promise<SessionInfo | undefined>;

type InboxItem = { type: string; payload: { text?: string; files?: unknown[] } };

type ToolProgress = {
	name: string;
	created: number;
	ran?: number;
	raw: string;
	input?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

type Step = {
	info: AssistantMessage;
	texts: Map<number, string>;
	reasoning: Map<number, { text: string; start: number; end?: number }>;
	tools: Map<string, ToolProgress>;
};

type SessionTrack = {
	directory: string;
	agent: string;
	model: { providerID: string; modelID: string; variant?: string };
	lastUserId: string;
	inbox: Map<string, InboxItem>;
	steps: Map<string, Step>;
	/** Shell run id → its message id, from `session.shell.started`. */
	shells: Map<string, { id: string; created: number }>;
	/** The running compaction's message id and start. */
	compaction?: { id: string; auto: boolean; created: number } | undefined;
};

/** v2 names a message after the event that started it (`evt_…` → `msg_…`). */
const messageIdOf = (eventID: string) => eventID.replace(/^evt_/, "msg_");

const SESSION_CHANGES: ReadonlySet<string> = new Set([
	"session.renamed",
	"session.metadata.updated",
	"session.archived",
	"session.unarchived",
	"session.moved",
	"session.permissions",
	"session.revert.staged",
	"session.revert.cleared",
	"session.revert.committed",
]);

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

/** Kilo v2 events the thread controller reads as they are. */
const PASSED_THROUGH: ReadonlySet<string> = new Set([
	"permission.asked",
	"permission.replied",
	"form.created",
	"form.replied",
	"form.cancelled",
]);

export class V2EventTranslator {
	readonly #readSession: ReadSession | undefined;
	readonly #sessions = new Map<string, SessionTrack>();

	constructor(options: { readSession?: ReadSession } = {}) {
		this.#readSession = options.readSession;
	}

	/** Forgets in-flight steps and inbox items, after a reconnect (history reloads). */
	reset(): void {
		this.#sessions.clear();
	}

	#track(sessionID: string, directory: string | undefined): SessionTrack {
		let track = this.#sessions.get(sessionID);
		if (!track) {
			track = {
				directory: directory ?? "",
				agent: "",
				model: { providerID: "", modelID: "" },
				lastUserId: "",
				inbox: new Map(),
				steps: new Map(),
				shells: new Map(),
			};
			this.#sessions.set(sessionID, track);
		} else if (directory) {
			track.directory = directory;
		}
		return track;
	}

	async translate(event: OpenCodeEvent): Promise<V1Event[]> {
		const directory = event.location?.directory;
		const at = (type: string, properties: Record<string, unknown>): V1Event =>
			directory ? { type, properties, directory } : { type, properties };
		const data = record(event.data);
		const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;

		if (
			event.type === "session.created" ||
			event.type === "session.forked" ||
			SESSION_CHANGES.has(event.type)
		) {
			const info = sessionID ? await this.#readSession?.(sessionID) : undefined;
			if (!info) return [];
			const type =
				event.type === "session.created" || event.type === "session.forked"
					? "session.created"
					: "session.updated";
			return [at(type, { info: toV1Session(info) })];
		}
		if (event.type === "server.connected") return [at("server.connected", {})];
		if (PASSED_THROUGH.has(event.type)) return [at(event.type, data)];
		if (!sessionID) return [];

		const track = this.#track(sessionID, directory);
		const status = (type: string, extra: Record<string, unknown> = {}) =>
			at("session.status", { sessionID, status: { type, ...extra } });
		const idle = () => [status("idle"), at("session.idle", { sessionID })];
		const partUpdated = (part: Part) => at("message.part.updated", { part });

		switch (event.type) {
			case "session.deleted":
				this.#sessions.delete(sessionID);
				return [at("session.deleted", { info: { id: sessionID } })];
			case "session.agent.selected": {
				track.agent = String(data.agent);
				// The session's agent changed: announce it, read again, as other session changes.
				const info = await this.#readSession?.(sessionID);
				return info ? [at("session.updated", { info: toV1Session(info) })] : [];
			}
			case "session.model.selected": {
				const model = record(data.model);
				track.model = {
					providerID: String(model.providerID),
					modelID: String(model.id),
					...(typeof model.variant === "string" ? { variant: model.variant } : {}),
				};
				return [];
			}
			case "session.execution.started":
				return [status("busy")];
			case "session.retry.scheduled": {
				const error = record(data.error);
				return [
					status("retry", {
						attempt: data.attempt,
						message: String(error.message ?? ""),
						next: data.at,
					}),
				];
			}
			case "session.idle":
			case "session.execution.succeeded":
			case "session.execution.interrupted":
				return idle();
			case "session.execution.failed":
				return [
					at("session.error", {
						sessionID,
						error: toV1Error(data.error as SessionStructuredError),
					}),
					...idle(),
				];
			case "session.compaction.started": {
				const id = typeof data.inputID === "string" ? data.inputID : messageIdOf(event.id);
				track.compaction = { id, auto: data.reason === "auto", created: event.created };
				return this.#messages(
					sessionID,
					track,
					toV1CompactionMessages(sessionID, track.directory, track, track.compaction),
				).map(({ type, properties }) => at(type, properties));
			}
			case "session.compaction.ended": {
				const started = track.compaction ?? {
					id: messageIdOf(event.id),
					auto: data.reason === "auto",
					created: event.created,
				};
				track.compaction = undefined;
				const model = record(data.model);
				const messages = toV1CompactionMessages(sessionID, track.directory, track, {
					...started,
					summary: String(data.text ?? ""),
					...(typeof model.id === "string"
						? { model: { id: model.id, providerID: String(model.providerID) } }
						: {}),
					...(typeof data.cost === "number" ? { cost: data.cost } : {}),
					...(data.tokens ? { tokens: data.tokens as never } : {}),
				});
				return [
					...this.#messages(sessionID, track, messages).map(({ type, properties }) =>
						at(type, properties),
					),
					at("session.compacted", { sessionID }),
				];
			}
			case "session.compaction.failed":
				track.compaction = undefined;
				return [
					at("session.error", {
						sessionID,
						error: toV1Error(data.error as SessionStructuredError),
					}),
				];
			case "session.shell.started":
			case "session.shell.ended": {
				const shell = record(data.shell);
				const shellID = String(shell.id);
				const known = track.shells.get(shellID) ?? {
					id: messageIdOf(event.id),
					created: event.created,
				};
				const ended = event.type === "session.shell.ended";
				if (ended) track.shells.delete(shellID);
				else track.shells.set(shellID, known);
				const time = record(shell.time);
				const message = toV1ShellMessage(
					sessionID,
					track.directory,
					{ agent: track.agent, model: track.model, parentID: track.lastUserId },
					{
						id: known.id,
						shellID,
						command: String(shell.command ?? ""),
						status: ended ? String(shell.status) : "running",
						exit: typeof shell.exit === "number" ? shell.exit : undefined,
						output: ended ? String(record(data.output).output ?? "") : undefined,
						created: typeof time.started === "number" ? time.started : known.created,
						completed: ended
							? typeof time.completed === "number"
								? time.completed
								: event.created
							: undefined,
					},
				);
				return this.#messages(sessionID, track, [message]).map(({ type, properties }) =>
					at(type, properties),
				);
			}
			case "session.skill.activated": {
				const id = messageIdOf(event.id);
				const info: UserMessage = {
					id,
					sessionID,
					role: "user",
					time: { created: event.created },
					agent: track.agent,
					model: track.model,
				};
				return [
					at("message.updated", { info }),
					at("message.part.updated", {
						part: {
							id: textPartId(id, 0),
							sessionID,
							messageID: id,
							type: "text",
							text: String(data.text ?? ""),
							synthetic: true,
						},
					}),
				];
			}

			case "session.inbox.enqueued": {
				const item = record(data.item);
				if (typeof data.inboxID === "string") {
					track.inbox.set(data.inboxID, {
						type: String(item.type),
						payload: record(item.payload) as InboxItem["payload"],
					});
				}
				return [];
			}
			case "session.inbox.cancelled":
				if (typeof data.inboxID === "string") track.inbox.delete(data.inboxID);
				return [];
			case "session.inbox.delivered":
				return this.#delivered(track, sessionID, String(data.inboxID), event.created).map(
					({ type, properties }) => at(type, properties),
				);

			case "session.step.started": {
				const messageID = String(data.assistantMessageID);
				const model = record(data.model);
				const agent = String(data.agent);
				track.agent = agent;
				const info = toV1AssistantInfo(sessionID, track.directory, {
					id: messageID,
					created: typeof data.started === "number" ? data.started : event.created,
					agent,
					model: {
						id: String(model.id),
						providerID: String(model.providerID),
						...(typeof model.variant === "string" ? { variant: model.variant } : {}),
					},
					parentID: track.lastUserId,
				});
				track.steps.set(messageID, {
					info,
					texts: new Map(),
					reasoning: new Map(),
					tools: new Map(),
				});
				return [
					at("message.updated", { info }),
					partUpdated({
						id: stepStartPartId(messageID),
						sessionID,
						messageID,
						type: "step-start",
						...(typeof data.snapshot === "string" ? { snapshot: data.snapshot } : {}),
					}),
				];
			}
			case "session.step.ended":
			case "session.step.failed": {
				const messageID = String(data.assistantMessageID);
				const step = track.steps.get(messageID);
				if (!step) return [];
				const failed = event.type === "session.step.failed";
				const tokens = (data.tokens as AssistantMessage["tokens"] | undefined) ?? step.info.tokens;
				const cost = typeof data.cost === "number" ? data.cost : step.info.cost;
				const finish = typeof data.finish === "string" ? data.finish : failed ? "error" : undefined;
				step.info = {
					...step.info,
					time: { ...step.info.time, completed: event.created },
					cost,
					tokens,
					...(finish ? { finish } : {}),
					...(failed ? { error: toV1Error(data.error as SessionStructuredError) } : {}),
				};
				track.steps.delete(messageID);
				return [
					at("message.updated", { info: step.info }),
					...(failed
						? []
						: [
								partUpdated({
									id: stepFinishPartId(messageID),
									sessionID,
									messageID,
									type: "step-finish",
									reason: finish ?? "unknown",
									...(typeof data.snapshot === "string" ? { snapshot: data.snapshot } : {}),
									cost,
									tokens,
								}),
							]),
				];
			}

			case "session.text.started":
			case "session.text.delta":
			case "session.text.ended":
				return this.#text(track, sessionID, event.type, data).map(({ type, properties }) =>
					at(type, properties),
				);
			case "session.reasoning.started":
			case "session.reasoning.delta":
			case "session.reasoning.ended":
				return this.#reasoning(track, sessionID, event.type, data, event.created).map(
					({ type, properties }) => at(type, properties),
				);
			case "session.tool.input.started":
			case "session.tool.input.delta":
			case "session.tool.input.ended":
			case "session.tool.called":
			case "session.tool.progress":
			case "session.tool.success":
			case "session.tool.failed": {
				const part = this.#tool(track, sessionID, event.type, data, event.created);
				return part ? [partUpdated(part)] : [];
			}
			default:
				return [];
		}
	}

	/** Whole v1 messages as the events that announce them. */
	#messages(
		_sessionID: string,
		_track: SessionTrack,
		messages: readonly MessageWithParts[],
	): V1Event[] {
		return messages.flatMap((message) => [
			{ type: "message.updated", properties: { info: message.info } },
			...message.parts.map((part) => ({ type: "message.part.updated", properties: { part } })),
		]);
	}

	#delivered(track: SessionTrack, sessionID: string, inboxID: string, created: number): V1Event[] {
		const item = track.inbox.get(inboxID);
		if (!item) return [];
		track.inbox.delete(inboxID);
		if (item.type !== "user" && item.type !== "synthetic") return [];
		const synthetic = item.type === "synthetic";
		const info: UserMessage = {
			id: inboxID,
			sessionID,
			role: "user",
			time: { created },
			agent: track.agent,
			model: track.model,
		};
		if (!synthetic) track.lastUserId = inboxID;
		const files = (item.payload.files ?? []).flatMap((file, index) => {
			const value = record(file);
			return typeof value.data === "string" && typeof value.mime === "string"
				? [
						toV1FilePart(sessionID, inboxID, index, {
							data: value.data,
							mime: value.mime,
							name: typeof value.name === "string" ? value.name : undefined,
						}),
					]
				: [];
		});
		return [
			{ type: "message.updated", properties: { info } },
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: textPartId(inboxID, 0),
						sessionID,
						messageID: inboxID,
						type: "text",
						text: item.payload.text ?? "",
						...(synthetic ? { synthetic: true } : {}),
					},
				},
			},
			...files.map((part) => ({ type: "message.part.updated", properties: { part } })),
		];
	}

	#text(
		track: SessionTrack,
		sessionID: string,
		type: string,
		data: Record<string, unknown>,
	): V1Event[] {
		const messageID = String(data.assistantMessageID);
		const ordinal = Number(data.ordinal);
		const step = track.steps.get(messageID);
		const partID = textPartId(messageID, ordinal);
		const part = (text: string): V1Event => ({
			type: "message.part.updated",
			properties: { part: { id: partID, sessionID, messageID, type: "text", text } },
		});
		if (type === "session.text.started") {
			step?.texts.set(ordinal, "");
			return [part("")];
		}
		if (type === "session.text.delta") {
			const delta = String(data.delta);
			const current = step?.texts.get(ordinal);
			if (step && current === undefined) {
				// A delta without its start (joined mid-turn): send the part whole.
				step.texts.set(ordinal, delta);
				return [part(delta)];
			}
			step?.texts.set(ordinal, (current ?? "") + delta);
			return [
				{
					type: "message.part.delta",
					properties: { sessionID, messageID, partID, field: "text", delta },
				},
			];
		}
		const text = String(data.text);
		step?.texts.set(ordinal, text);
		return [part(text)];
	}

	#reasoning(
		track: SessionTrack,
		sessionID: string,
		type: string,
		data: Record<string, unknown>,
		created: number,
	): V1Event[] {
		const messageID = String(data.assistantMessageID);
		const ordinal = Number(data.ordinal);
		const step = track.steps.get(messageID);
		const partID = reasoningPartId(messageID, ordinal);
		const current = step?.reasoning.get(ordinal) ?? { text: "", start: created };
		const part = (value: { text: string; start: number; end?: number }): V1Event => ({
			type: "message.part.updated",
			properties: {
				part: {
					id: partID,
					sessionID,
					messageID,
					type: "reasoning",
					text: value.text,
					time: { start: value.start, ...(value.end === undefined ? {} : { end: value.end }) },
				},
			},
		});
		if (type === "session.reasoning.started") {
			step?.reasoning.set(ordinal, current);
			return [part(current)];
		}
		if (type === "session.reasoning.delta") {
			const delta = String(data.delta);
			const known = step?.reasoning.has(ordinal) ?? true;
			const next = { ...current, text: current.text + delta };
			step?.reasoning.set(ordinal, next);
			return known
				? [
						{
							type: "message.part.delta",
							properties: { sessionID, messageID, partID, field: "text", delta },
						},
					]
				: [part(next)];
		}
		const ended = { ...current, text: String(data.text), end: created };
		step?.reasoning.set(ordinal, ended);
		return [part(ended)];
	}

	#tool(
		track: SessionTrack,
		sessionID: string,
		type: string,
		data: Record<string, unknown>,
		created: number,
	): Part | undefined {
		const messageID = String(data.assistantMessageID);
		const callID = String(data.id);
		const step = track.steps.get(messageID);
		const tools = step?.tools ?? new Map<string, ToolProgress>();
		const tool = tools.get(callID) ?? { name: String(data.name ?? ""), created, raw: "" };
		tools.set(callID, tool);
		let state: ToolState;
		switch (type) {
			case "session.tool.input.started":
				tool.name = String(data.name);
				state = { status: "pending", input: {}, raw: "" };
				break;
			case "session.tool.input.delta":
				tool.raw += String(data.delta);
				state = { status: "pending", input: {}, raw: tool.raw };
				break;
			case "session.tool.input.ended":
				tool.raw = String(data.text);
				state = { status: "pending", input: {}, raw: tool.raw };
				break;
			case "session.tool.called":
				tool.input = record(data.input);
				tool.ran = created;
				state = {
					status: "running",
					input: toV1ToolInput(tool.name, tool.input),
					time: { start: created },
				};
				break;
			case "session.tool.progress":
				tool.metadata = record(data.metadata);
				state = {
					status: "running",
					input: toV1ToolInput(tool.name, tool.input ?? {}),
					metadata: toV1ToolMetadata(tool.name, tool.metadata ?? {}),
					time: { start: tool.ran ?? tool.created },
				};
				break;
			default: {
				const v2Tool = {
					type: "tool",
					id: callID,
					name: tool.name,
					time: { created: tool.created, ran: tool.ran ?? tool.created, completed: created },
					state:
						type === "session.tool.success"
							? {
									status: "completed",
									input: tool.input ?? {},
									content: data.content,
									metadata: data.metadata ?? tool.metadata ?? {},
								}
							: {
									status: "error",
									input: tool.input ?? {},
									error: data.error,
									...(data.metadata || tool.metadata
										? { metadata: data.metadata ?? tool.metadata }
										: {}),
								},
				} as unknown as V2Tool;
				state = toV1ToolState(sessionID, messageID, v2Tool);
				tools.delete(callID);
			}
		}
		if (!tool.name) return undefined;
		return {
			id: toolPartId(messageID, callID),
			sessionID,
			messageID,
			type: "tool",
			callID,
			tool: toV1ToolName(tool.name),
			state,
		};
	}
}
