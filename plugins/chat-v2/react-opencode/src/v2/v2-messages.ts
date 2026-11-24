import type {
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageInfo,
	SessionStructuredError,
	ToolContent,
} from "@kilocode/client";

import { toV1ToolInput, toV1ToolMetadata, toV1ToolName } from "./v2-tools";
import type {
	AssistantMessage,
	FilePart,
	MessageWithParts,
	Part,
	Session,
	ToolState,
	UserMessage,
} from "../types";

/**
 * Kilo v2's transcript in the v1 message shapes this fork keeps as its own
 * vocabulary (thread state, projection, kilo.chat's renderers), so they stay
 * as they were.
 *
 * v2 has one flat message union: `user`, `synthetic`, `assistant` (its
 * text, reasoning and tool content inline), `compaction`, `shell`, `skill`,
 * and markers (`agent-switched`, `model-switched`, `location-switched`,
 * `system`, `idle`) that v1 had no message for. v1 had user and assistant
 * messages, each with parts. Part ids are derived, so the history and the
 * live events (`v2-events.ts`) name the same part the same way: text and
 * reasoning by their position among the message's parts of that kind (the
 * `ordinal` of v2's streaming events), tools by call id.
 */

export type V2Message = SessionMessageInfo;

export const textPartId = (messageId: string, ordinal: number) => `${messageId}:text:${ordinal}`;
export const reasoningPartId = (messageId: string, ordinal: number) =>
	`${messageId}:reasoning:${ordinal}`;
export const toolPartId = (messageId: string, callId: string) => `${messageId}:tool:${callId}`;
export const stepStartPartId = (messageId: string) => `${messageId}:step-start`;
export const stepFinishPartId = (messageId: string) => `${messageId}:step-finish`;

/** v1's error shape (`{ name, data: { message } }`) for a v2 structured error. */
export function toV1Error(error: SessionStructuredError): NonNullable<AssistantMessage["error"]> {
	return { name: error.type, data: { message: error.message } } as never;
}

/** v1's `output`/`attachments` for a v2 tool's content. */
export function toolOutput(
	sessionID: string,
	messageID: string,
	content: readonly ToolContent[] | undefined,
): { output: string; attachments: FilePart[] } {
	const parts = content ?? [];
	return {
		output: parts.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n"),
		attachments: parts.flatMap((item, index) =>
			item.type === "file"
				? [
						{
							id: `${messageID}:attachment:${index}`,
							sessionID,
							messageID,
							type: "file" as const,
							mime: item.mime,
							url: item.uri,
							...(item.name ? { filename: item.name } : {}),
						},
					]
				: [],
		),
	};
}

type V2Tool = Extract<SessionMessageAssistant["content"][number], { type: "tool" }>;
export type { V2Tool };

export function toV1ToolState(sessionID: string, messageID: string, tool: V2Tool): ToolState {
	const start = tool.time.ran ?? tool.time.created;
	const state = tool.state;
	const input = (value: Record<string, unknown>) => toV1ToolInput(tool.name, value);
	switch (state.status) {
		case "streaming":
			return { status: "pending", input: {}, raw: state.input };
		case "running":
			return {
				status: "running",
				input: input(state.input),
				metadata: toV1ToolMetadata(tool.name, state.metadata),
				time: { start },
			};
		case "completed": {
			const result = toolOutput(sessionID, messageID, state.content);
			return {
				status: "completed",
				input: input(state.input),
				title: "",
				metadata: toV1ToolMetadata(tool.name, state.metadata ?? {}, result.output) ?? {},
				time: { start, end: tool.time.completed ?? start },
				...result,
			};
		}
		case "error": {
			const metadata = toV1ToolMetadata(tool.name, state.metadata);
			return {
				status: "error",
				input: input(state.input),
				error: state.error.message,
				...(metadata ? { metadata } : {}),
				time: { start, end: tool.time.completed ?? start },
			};
		}
	}
}

const tokensOf = (tokens: SessionMessageAssistant["tokens"]) =>
	tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

interface Context {
	readonly sessionID: string;
	readonly directory: string;
	agent: string;
	model: { providerID: string; modelID: string; variant?: string };
	lastUserId: string;
}

function userMessage(
	context: Context,
	id: string,
	created: number,
	text: string,
	options: { synthetic?: boolean; files?: FilePart[] } = {},
): MessageWithParts {
	const info: UserMessage = {
		id,
		sessionID: context.sessionID,
		role: "user",
		time: { created },
		agent: context.agent,
		model: context.model,
	};
	const parts: Part[] = [
		{
			id: textPartId(id, 0),
			sessionID: context.sessionID,
			messageID: id,
			type: "text",
			text,
			...(options.synthetic ? { synthetic: true } : {}),
		},
		...(options.files ?? []),
	];
	return { info, parts };
}

export function toV1AssistantInfo(
	sessionID: string,
	directory: string,
	message: {
		id: string;
		created: number;
		completed?: number | undefined;
		agent: string;
		model: { id: string; providerID: string; variant?: string | undefined };
		parentID: string;
		error?: SessionStructuredError | undefined;
		cost?: number | undefined;
		tokens?: SessionMessageAssistant["tokens"];
		finish?: string | undefined;
	},
): AssistantMessage {
	return {
		id: message.id,
		sessionID,
		role: "assistant",
		time: {
			created: message.created,
			...(message.completed === undefined ? {} : { completed: message.completed }),
		},
		parentID: message.parentID,
		modelID: message.model.id,
		providerID: message.model.providerID,
		...(message.model.variant ? { variant: message.model.variant } : {}),
		mode: message.agent,
		agent: message.agent,
		path: { cwd: directory, root: directory },
		cost: message.cost ?? 0,
		tokens: tokensOf(message.tokens),
		...(message.finish ? { finish: message.finish } : {}),
		...(message.error ? { error: toV1Error(message.error) } : {}),
	};
}

type V2Content = SessionMessageAssistant["content"][number];

/** An assistant message's v2 content as v1 parts, with ids `v2-events.ts` derives the same way. */
export function toV1ContentParts(
	sessionID: string,
	messageID: string,
	content: readonly V2Content[],
	created: number,
): Part[] {
	const ordinals = { text: 0, reasoning: 0 };
	return content.map((item): Part => {
		if (item.type === "text") {
			return {
				id: textPartId(messageID, ordinals.text++),
				sessionID,
				messageID,
				type: "text",
				text: item.text,
			};
		}
		if (item.type === "reasoning") {
			return {
				id: reasoningPartId(messageID, ordinals.reasoning++),
				sessionID,
				messageID,
				type: "reasoning",
				text: item.text,
				time: {
					start: item.time?.created ?? created,
					...(item.time?.completed === undefined ? {} : { end: item.time.completed }),
				},
			};
		}
		return {
			id: toolPartId(messageID, item.id),
			sessionID,
			messageID,
			type: "tool",
			callID: item.id,
			tool: toV1ToolName(item.name),
			state: toV1ToolState(sessionID, messageID, item),
		};
	});
}

function assistantMessage(context: Context, message: SessionMessageAssistant): MessageWithParts {
	const { sessionID } = context;
	const id = message.id;
	const info = toV1AssistantInfo(sessionID, context.directory, {
		id,
		created: message.time.created,
		completed: message.time.completed,
		agent: message.agent,
		model: message.model,
		parentID: context.lastUserId,
		error: message.error,
		cost: message.cost,
		tokens: message.tokens,
		finish: message.finish,
	});
	const parts: Part[] = [
		{
			id: stepStartPartId(id),
			sessionID,
			messageID: id,
			type: "step-start",
			...(message.snapshot?.start ? { snapshot: message.snapshot.start } : {}),
		},
		...toV1ContentParts(sessionID, id, message.content, message.time.created),
	];
	if (message.finish) {
		parts.push({
			id: stepFinishPartId(id),
			sessionID,
			messageID: id,
			type: "step-finish",
			reason: message.finish,
			...(message.snapshot?.end ? { snapshot: message.snapshot.end } : {}),
			cost: message.cost ?? 0,
			tokens: tokensOf(message.tokens),
		});
	}
	return { info, parts };
}

/** Who a message without its own agent and model stands for: the session's current ones. */
export interface V1Speaker {
	readonly agent: string;
	readonly model: { providerID: string; modelID: string };
	readonly parentID: string;
}

/** A shell command run from the composer, shown as v1 did: a `bash` tool call. */
export function toV1ShellMessage(
	sessionID: string,
	directory: string,
	speaker: V1Speaker,
	shell: {
		readonly id: string;
		readonly shellID: string;
		readonly command: string;
		readonly status: string;
		readonly exit?: number | undefined;
		readonly output?: string | undefined;
		readonly created: number;
		readonly completed?: number | undefined;
	},
): MessageWithParts {
	const { id, created: start } = shell;
	const end = shell.completed ?? start;
	const output = shell.output ?? "";
	const state: ToolState =
		shell.status === "running"
			? { status: "running", input: { command: shell.command }, time: { start } }
			: {
					status: "completed",
					input: { command: shell.command },
					output,
					title: shell.command,
					metadata: { exit: shell.exit ?? null, status: shell.status, output },
					time: { start, end },
				};
	return {
		info: toV1AssistantInfo(sessionID, directory, {
			id,
			created: start,
			...(shell.completed === undefined ? {} : { completed: end }),
			agent: speaker.agent,
			model: { id: speaker.model.modelID, providerID: speaker.model.providerID },
			parentID: speaker.parentID,
		}),
		parts: [
			{
				id: toolPartId(id, shell.shellID),
				sessionID,
				messageID: id,
				type: "tool",
				callID: shell.shellID,
				tool: "bash",
				state,
			},
		],
	};
}

/** A compaction as v1 showed it: its request, then (once done) the summary as a reply. */
export function toV1CompactionMessages(
	sessionID: string,
	directory: string,
	speaker: Omit<V1Speaker, "parentID"> & { readonly variant?: string },
	compaction: {
		readonly id: string;
		readonly auto: boolean;
		readonly created: number;
		readonly summary?: string | undefined;
		readonly model?: { id: string; providerID: string; variant?: string } | undefined;
		readonly cost?: number | undefined;
		readonly tokens?: SessionMessageAssistant["tokens"];
	},
): MessageWithParts[] {
	const { id } = compaction;
	const request: MessageWithParts = {
		info: {
			id,
			sessionID,
			role: "user",
			time: { created: compaction.created },
			agent: speaker.agent,
			model: speaker.model,
		},
		parts: [
			{
				id: `${id}:compaction`,
				sessionID,
				messageID: id,
				type: "compaction",
				auto: compaction.auto,
			},
		],
	};
	if (compaction.summary === undefined) return [request];
	const summaryId = `${id}:summary`;
	const summary = toV1AssistantInfo(sessionID, directory, {
		id: summaryId,
		created: compaction.created,
		completed: compaction.created,
		agent: speaker.agent,
		model: compaction.model ?? { id: speaker.model.modelID, providerID: speaker.model.providerID },
		parentID: id,
		cost: compaction.cost,
		tokens: compaction.tokens,
		finish: "stop",
	});
	return [
		request,
		{
			info: { ...summary, summary: true },
			parts: [
				{
					id: textPartId(summaryId, 0),
					sessionID,
					messageID: summaryId,
					type: "text",
					text: compaction.summary,
				},
			],
		},
	];
}

/** A prompt's attached file as v1's file part, its bytes inline as a data URL. */
export function toV1FilePart(
	sessionID: string,
	messageID: string,
	index: number,
	file: { data: string; mime: string; name?: string | undefined },
): FilePart {
	return {
		id: `${messageID}:file:${index}`,
		sessionID,
		messageID,
		type: "file",
		mime: file.mime,
		url: `data:${file.mime};base64,${file.data}`,
		...(file.name ? { filename: file.name } : {}),
	};
}

/**
 * A session's v2 messages, oldest first, as v1 messages. Markers set the
 * agent and model later user messages carry and are not shown; a compaction
 * becomes v1's compaction request with its summary as a summary reply.
 */
export function toV1Messages(
	sessionID: string,
	directory: string,
	messages: readonly V2Message[],
): MessageWithParts[] {
	const context: Context = {
		sessionID,
		directory,
		agent: "",
		model: { providerID: "", modelID: "" },
		lastUserId: "",
	};
	const result: MessageWithParts[] = [];
	for (const message of messages) {
		switch (message.type) {
			case "agent-switched":
				context.agent = message.agent;
				break;
			case "model-switched":
				context.model = {
					providerID: message.model.providerID,
					modelID: message.model.id,
					...(message.model.variant ? { variant: message.model.variant } : {}),
				};
				break;
			case "user": {
				const files = (message.files ?? []).map((file, index) =>
					toV1FilePart(sessionID, message.id, index, file),
				);
				result.push(
					userMessage(context, message.id, message.time.created, message.text, { files }),
				);
				context.lastUserId = message.id;
				break;
			}
			case "synthetic":
				result.push(
					userMessage(context, message.id, message.time.created, message.text, {
						synthetic: true,
					}),
				);
				break;
			case "skill":
				result.push(
					userMessage(context, message.id, message.time.created, message.text, {
						synthetic: true,
					}),
				);
				break;
			case "assistant":
				context.agent = message.agent;
				result.push(assistantMessage(context, message));
				break;
			case "shell":
				result.push(
					toV1ShellMessage(
						sessionID,
						directory,
						{ agent: context.agent, model: context.model, parentID: context.lastUserId },
						{
							id: message.id,
							shellID: message.shellID,
							command: message.command,
							status: message.status,
							exit: typeof message.exit === "number" ? message.exit : undefined,
							output: message.output?.output,
							created: message.time.created,
							completed: message.time.completed,
						},
					),
				);
				break;
			case "compaction":
				result.push(
					...toV1CompactionMessages(sessionID, directory, context, {
						id: message.id,
						auto: message.reason === "auto",
						created: message.time.created,
						...(message.status === "completed"
							? {
									summary: message.summary,
									model: message.model,
									cost: message.cost,
									tokens: message.tokens,
								}
							: {}),
					}),
				);
				break;
			default:
				break;
		}
	}
	return result;
}

/** A v2 session as v1's session object; its directory is its location. */
export function toV1Session(info: SessionInfo): Session {
	return {
		id: info.id,
		slug: "",
		projectID: info.projectID,
		directory: info.location.directory,
		...(info.parentID ? { parentID: info.parentID } : {}),
		title: info.title ?? "",
		version: "",
		...(info.agent ? { agent: info.agent } : {}),
		...(info.model ? { model: info.model } : {}),
		...(info.metadata ? { metadata: info.metadata as Record<string, unknown> } : {}),
		cost: info.cost,
		tokens: info.tokens,
		...(info.revert
			? {
					revert: {
						messageID: info.revert.messageID,
						...(info.revert.partID ? { partID: info.revert.partID } : {}),
						...(info.revert.snapshot ? { snapshot: info.revert.snapshot } : {}),
						...(info.revert.workspace ? { workspace: info.revert.workspace } : {}),
					},
				}
			: {}),
		time: {
			created: info.time.created,
			updated: info.time.updated,
			...(info.time.archived === undefined ? {} : { archived: info.time.archived }),
		},
	};
}
