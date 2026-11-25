// Projects a Kilo v2 thread state into assistant-ui ThreadMessages.
//
// - A user message is a user ThreadMessage (text and file attachments).
//   Synthetic notes, system instructions, selections and location switches
//   are Kilo's own context and are not shown.
// - Consecutive assistant messages (one per model step) form one assistant
//   ThreadMessage, so a turn reads as one reply. Each step opens with an
//   `opencode-step-start` data part and closes with `opencode-step-finish`
//   (its finish, cost and tokens); its reasoning, text and tool calls carry
//   the step's id as `parentId`.
// - A turn's status comes from its last step and the `idle` message that
//   ends it: running while the session runs, cancelled when interrupted or
//   stopped between steps, an error when the step or turn failed, and
//   requires-action while a tool call waits on a permission or question.
// - A staged revert hides its boundary message and everything after it.
// - `metadata.custom.opencode.messages` carries the v2 messages behind each
//   projected message for renderers that need more than the parts.
import {
	ExportedMessageRepository,
	type MessageTiming,
	type ThreadMessage,
} from "@assistant-ui/react";
import { resolveFileMediaType, resolveImageMediaType } from "@assistant-ui/core/internal";
import type {
	SessionMessageAssistant,
	SessionMessageAssistantTool,
	SessionMessageInfo,
	SessionMessageUser,
} from "@kilocode/client";

import {
	projectOpenCodePermissionApproval,
	projectResolvedOpenCodePermissionApproval,
} from "./openCodePermissionApproval";
import { getOpenCodeTaskSessionId } from "./openCodeTaskSession";
import type {
	OpenCodeProjectedThreadMessage,
	OpenCodeThreadState,
	PendingUserMessage,
	ThreadUserMessagePart,
} from "./types";

type ProjectedContentPart = Exclude<OpenCodeProjectedThreadMessage["content"], string>[number];
type Assistant = SessionMessageAssistant;
type Tool = SessionMessageAssistantTool;

export interface LocalMcpApp {
	resourceUri: string;
	serverId: string;
}

let _localMcpApps: Record<string, LocalMcpApp> = {};

/**
 * Inject a host-local MCP App registry (tool name -> ui:// resource). The
 * projection synthesizes `mcp.app` metadata for matching tool-call parts so
 * hosts can render MCP Apps for tools whose wire metadata lacks `_meta.ui`.
 */
export function setLocalMcpApps(registry: Record<string, LocalMcpApp>): void {
	_localMcpApps = registry;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const createdAtOf = (message: OpenCodeProjectedThreadMessage) =>
	message.createdAt instanceof Date ? message.createdAt.getTime() : Date.now();

/** Server messages in their order, pending prompts placed by time. */
const mergeProjectedMessages = (
	serverMessages: readonly OpenCodeProjectedThreadMessage[],
	pendingMessages: readonly OpenCodeProjectedThreadMessage[],
) => {
	if (pendingMessages.length === 0) return [...serverMessages];
	const merged: OpenCodeProjectedThreadMessage[] = [];
	let pendingIndex = 0;
	for (const message of serverMessages) {
		while (
			pendingIndex < pendingMessages.length &&
			createdAtOf(pendingMessages[pendingIndex]!) < createdAtOf(message)
		) {
			merged.push(pendingMessages[pendingIndex]!);
			pendingIndex += 1;
		}
		merged.push(message);
	}
	return [...merged, ...pendingMessages.slice(pendingIndex)];
};

/** A tool's output as text (its text content joined), for renderers that read a string. */
export const toolContentText = (tool: Tool): string | undefined => {
	const content = (tool.state as { content?: readonly { type: string; text?: string }[] }).content;
	if (!content) return undefined;
	return content
		.flatMap((item) => (item.type === "text" && item.text !== undefined ? [item.text] : []))
		.join("\n");
};

/** A tool call's input once complete; a streaming call's partial JSON parsed when it can be. */
export const toolInput = (tool: Tool): Record<string, unknown> => {
	const input = tool.state.input;
	if (isRecord(input)) return input;
	if (typeof input === "string" && input.length > 0) {
		try {
			const parsed: unknown = JSON.parse(input);
			if (isRecord(parsed)) return parsed;
		} catch {
			// Still streaming.
		}
	}
	return {};
};

const mapToolState = (tool: Tool) => {
	const args = toolInput(tool);
	const argsText = JSON.stringify(args);
	if (tool.state.status === "completed") {
		return { args, argsText, result: toolContentText(tool) ?? "", isError: false };
	}
	if (tool.state.status === "error") {
		return { args, argsText, result: tool.state.error.message, isError: true };
	}
	return { args, argsText, result: undefined, isError: false };
};

type PermissionState = OpenCodeThreadState["interactions"]["permissions"];
type PendingPermission = PermissionState["pending"][string];
type ResolvedPermission = PermissionState["resolved"][string];

interface PermissionIndex {
	readonly pendingByCallId: ReadonlyMap<string, PendingPermission>;
	readonly resolvedByCallId: ReadonlyMap<string, ResolvedPermission>;
}

const permissionIndexCache = new WeakMap<PermissionState, PermissionIndex>();

const getPermissionIndex = (state: OpenCodeThreadState): PermissionIndex => {
	const permissions = state.interactions.permissions;
	const cached = permissionIndexCache.get(permissions);
	if (cached) return cached;
	const pendingByCallId = new Map<string, PendingPermission>();
	for (const request of Object.values(permissions.pending)) {
		if (request.source?.id) pendingByCallId.set(request.source.id, request);
	}
	const resolvedByCallId = new Map<string, ResolvedPermission>();
	for (const entry of Object.values(permissions.resolved)) {
		if (entry.request.source?.id) resolvedByCallId.set(entry.request.source.id, entry);
	}
	const index = { pendingByCallId, resolvedByCallId };
	permissionIndexCache.set(permissions, index);
	return index;
};

/** The tool call a question form belongs to (`metadata.tool.id`). */
export const questionToolCallId = (form: { metadata?: unknown }): string | undefined => {
	const tool = isRecord(form.metadata) ? form.metadata.tool : undefined;
	return isRecord(tool) && typeof tool.id === "string" ? tool.id : undefined;
};

const hasPendingInteractionForToolCall = (state: OpenCodeThreadState, toolCallId: string) => {
	if (getPermissionIndex(state).pendingByCallId.has(toolCallId)) return true;
	return Object.values(state.interactions.questions.pending).some(
		(form) => questionToolCallId(form) === toolCallId,
	);
};

const hasPendingInteractionForSteps = (state: OpenCodeThreadState, steps: readonly Assistant[]) =>
	steps.some((step) =>
		step.content.some(
			(item) => item.type === "tool" && hasPendingInteractionForToolCall(state, item.id),
		),
	);

const childMessagesCache = new WeakMap<OpenCodeThreadState, readonly ThreadMessage[]>();

const getChildMessages = (childState: OpenCodeThreadState): readonly ThreadMessage[] => {
	const cached = childMessagesCache.get(childState);
	if (cached) return cached;
	const messages = projectOpenCodeThreadRepository(childState).messages.map(
		({ message }) => message,
	);
	childMessagesCache.set(childState, messages);
	return messages;
};

const makeDataPart = (name: string, data: Record<string, unknown>, parentId?: string) => ({
	type: "data" as const,
	name,
	data,
	...(parentId ? { parentId } : {}),
});

const sanitizeReasoningText = (text: string | undefined) =>
	(text ?? "")
		.replaceAll("[REDACTED]", "")
		.replaceAll("\\r\\n", "\n")
		.replaceAll("\\n", "\n")
		.replaceAll("\\t", "\t")
		.trim();

const mcpAppFor = (tool: Tool) => {
	const local = _localMcpApps[tool.name];
	const metadata = (tool.state as { metadata?: Record<string, unknown> }).metadata;
	const fromMetadata = metadata?.mcpApp as { resourceUri: string; serverId?: string } | undefined;
	const app = local ?? fromMetadata;
	return app ? { mcp: { app: { resourceUri: app.resourceUri, serverId: app.serverId } } } : {};
};

const projectTool = (
	state: OpenCodeThreadState,
	tool: Tool,
	stepId: string,
): ProjectedContentPart => {
	const toolState = mapToolState(tool);
	const childSessionId = getOpenCodeTaskSessionId(tool);
	const childState = childSessionId ? state.childSessionsById[childSessionId] : undefined;
	const childMessages =
		childState?.loadState.type === "ready" ? getChildMessages(childState) : undefined;
	const permission = getPermissionIndex(state).pendingByCallId.get(tool.id);
	const resolved = permission ? undefined : getPermissionIndex(state).resolvedByCallId.get(tool.id);
	return {
		type: "tool-call",
		toolCallId: tool.id,
		toolName: tool.name,
		args: toolState.args as never,
		argsText: toolState.argsText,
		...(toolState.result !== undefined ? { result: toolState.result } : {}),
		...(toolState.isError ? { isError: true } : {}),
		...(childMessages !== undefined ? { messages: childMessages } : {}),
		...(permission
			? { approval: projectOpenCodePermissionApproval(permission) }
			: resolved
				? { approval: projectResolvedOpenCodePermissionApproval(resolved) }
				: {}),
		...mcpAppFor(tool),
		parentId: stepId,
		// `mcp` is assistant-ui's MCP App field, not in the part's type.
	} as ProjectedContentPart;
};

const projectAssistantContent = (
	state: OpenCodeThreadState,
	steps: readonly Assistant[],
): ProjectedContentPart[] => {
	const content: ProjectedContentPart[] = [];
	for (const step of steps) {
		content.push(makeDataPart("opencode-step-start", { id: step.id, depth: 0 }));
		for (const item of step.content) {
			if (item.type === "text") {
				content.push({ type: "text", text: item.text });
			} else if (item.type === "reasoning") {
				const text = sanitizeReasoningText(item.text);
				if (text) content.push({ type: "reasoning", text, parentId: step.id });
			} else {
				content.push(projectTool(state, item, step.id));
			}
		}
		if (step.time.completed) {
			content.push(
				makeDataPart("opencode-step-finish", {
					id: step.id,
					reason: step.finish,
					cost: step.cost,
					tokens: step.tokens,
				}),
			);
		}
	}
	return content;
};

type ProjectedAttachment = NonNullable<OpenCodeProjectedThreadMessage["attachments"]>[number];

/** A pending prompt's parts: text as content, images and files as attachments. */
const splitUserParts = (
	parts: readonly ThreadUserMessagePart[],
): { content: ProjectedContentPart[]; attachments: ProjectedAttachment[] } => {
	const content: ProjectedContentPart[] = [];
	const attachments: ProjectedAttachment[] = [];
	for (const part of parts) {
		if (part.type !== "image" && part.type !== "file") {
			content.push(part as ProjectedContentPart);
			continue;
		}
		// The same ladders the outbound prompt uses, so the pending copy and the
		// server copy agree on the attachment's type and content type.
		const mediaType =
			part.type === "image"
				? resolveImageMediaType(part.image, (part as { contentType?: string }).contentType)
				: resolveFileMediaType(part.data, part.mimeType);
		attachments.push({
			id: attachments.length.toString(),
			type: mediaType.startsWith("image/") ? "image" : "file",
			name: part.filename ?? "file",
			contentType: mediaType,
			status: { type: "complete" },
			content: [part],
		});
	}
	return { content, attachments };
};

/** A stored prompt file as a data URL (inline files) or its URI. */
const fileUrl = (file: NonNullable<SessionMessageUser["files"]>[number]) =>
	file.source.type === "uri"
		? file.source.uri
		: file.data.startsWith("data:")
			? file.data
			: `data:${file.mime};base64,${file.data}`;

const projectUserMessage = (message: SessionMessageUser) => {
	const attachments: ProjectedAttachment[] = (message.files ?? []).map((file, index) => {
		const url = fileUrl(file);
		const name = file.name ?? "file";
		const image = file.mime.startsWith("image/");
		return {
			id: `${message.id}:${index}`,
			type: image ? "image" : "file",
			name,
			contentType: file.mime,
			status: { type: "complete" },
			content: [
				image
					? { type: "image", image: url, filename: name }
					: { type: "file", filename: name, data: url, mimeType: file.mime },
			],
		} as ProjectedAttachment;
	});
	const content: ProjectedContentPart[] = message.text
		? [{ type: "text", text: message.text }]
		: [];
	return { content, attachments };
};

const CANCELLED_STATUS = { type: "incomplete", reason: "cancelled" } as const;

// A turn ends on a model reply; one whose last step handed off to tools was
// halted before the next step. A completed plan_exit is the one tool that
// ends a turn by design.
const endsBetweenSteps = (step: Assistant): boolean =>
	step.finish === "tool-calls" &&
	!step.content.some(
		(item) =>
			item.type === "tool" && item.name === "plan_exit" && item.state.status === "completed",
	);

/** What every message's status reads about the run, computed once per projection. */
interface RunActivity {
	readonly lastGroupId: string | undefined;
	readonly isActiveRun: boolean;
}

const isActiveRun = (state: OpenCodeThreadState) =>
	state.running ||
	state.runState.type === "streaming" ||
	state.runState.type === "cancelling" ||
	state.runState.type === "reverting";

/**
 * One transcript message: a user message, or a run of assistant steps (with
 * the `idle` message that ended it, if any). `id` is the first step's id, so
 * the projected message keeps its identity as later steps join.
 */
interface MessageGroup {
	readonly id: string;
	readonly kind: "user" | "assistant";
	readonly sources: readonly SessionMessageInfo[];
	readonly steps: readonly Assistant[];
	readonly idle: Extract<SessionMessageInfo, { type: "idle" }> | undefined;
}

const getMessageStatus = (
	state: OpenCodeThreadState,
	group: MessageGroup,
	activity: RunActivity,
): OpenCodeProjectedThreadMessage["status"] => {
	const last = group.steps.at(-1);
	if (!last) return undefined;
	if (hasPendingInteractionForSteps(state, group.steps)) {
		return { type: "requires-action", reason: "tool-calls" };
	}
	const error = last.error ?? (group.idle?.outcome === "failed" ? group.idle.error : undefined);
	if (error) return { type: "incomplete", reason: "error", error: error.message };
	if (group.idle?.outcome === "interrupted") return CANCELLED_STATUS;
	const isActive = activity.lastGroupId === group.id && activity.isActiveRun;
	if (!last.time.completed) return isActive ? { type: "running" } : CANCELLED_STATUS;
	if (isActive) return { type: "running" };
	// Only the latest turn: an earlier one may end on tool calls when a queued
	// prompt took over the loop.
	if (activity.lastGroupId === group.id && !group.idle && endsBetweenSteps(last)) {
		return CANCELLED_STATUS;
	}
	return { type: "complete", reason: "stop" };
};

/** Visible messages grouped; Kilo's own context is skipped without breaking a run of steps. */
const groupMessages = (messages: readonly SessionMessageInfo[]): MessageGroup[] => {
	const groups: {
		id: string;
		kind: "user" | "assistant";
		sources: SessionMessageInfo[];
		steps: Assistant[];
		idle: MessageGroup["idle"];
	}[] = [];
	for (const message of messages) {
		const previous = groups.at(-1);
		if (message.type === "assistant") {
			if (previous?.kind === "assistant") {
				previous.sources.push(message);
				previous.steps.push(message);
			} else {
				groups.push({
					id: message.id,
					kind: "assistant",
					sources: [message],
					steps: [message],
					idle: undefined,
				});
			}
		} else if (message.type === "user") {
			groups.push({ id: message.id, kind: "user", sources: [message], steps: [], idle: undefined });
		} else if (message.type === "idle" && previous?.kind === "assistant") {
			previous.sources.push(message);
			previous.idle = message;
		}
	}
	return groups;
};

const projectGroup = (
	state: OpenCodeThreadState,
	group: MessageGroup,
	timing: MessageTiming | undefined,
	activity: RunActivity,
): OpenCodeProjectedThreadMessage => {
	const first = group.sources[0]!;
	const opencode = { messages: group.sources };
	if (group.kind === "user") {
		return {
			id: group.id,
			role: "user",
			createdAt: new Date(first.time.created),
			...projectUserMessage(first as SessionMessageUser),
			metadata: { custom: { opencode } },
		};
	}
	const last = group.steps.at(-1)!;
	return {
		id: group.id,
		role: "assistant",
		createdAt: new Date(first.time.created),
		content: projectAssistantContent(state, group.steps),
		status: getMessageStatus(state, group, activity),
		metadata: {
			custom: {
				opencode,
				modelID: last.model.id,
				providerID: last.model.providerID,
				agent: last.agent,
				cost: group.steps.reduce((sum, step) => sum + (step.cost ?? 0), 0),
				tokens: last.tokens,
			},
			...(timing && { timing }),
		},
	};
};

const projectPendingMessage = (pending: PendingUserMessage): OpenCodeProjectedThreadMessage => ({
	id: `local:${pending.clientId}`,
	role: "user",
	createdAt: new Date(pending.createdAt),
	...splitUserParts(pending.parts),
	metadata: {
		custom: {
			opencode: {
				messages: [],
				pending: true,
				clientId: pending.clientId,
				error:
					pending.status === "failed"
						? pending.error instanceof Error
							? pending.error.message
							: String(pending.error ?? "Failed to send message")
						: undefined,
			},
		},
	},
});

/** The transcript without a staged revert's boundary and what follows it. */
export const visibleMessages = (state: OpenCodeThreadState): readonly SessionMessageInfo[] => {
	const boundary = state.session?.revert?.messageID;
	if (!boundary) return state.messages;
	const at = state.messages.findIndex((message) => message.id === boundary);
	return at < 0 ? state.messages : state.messages.slice(0, at);
};

const sortedPendingMessages = (state: OpenCodeThreadState) =>
	Object.values(state.pendingUserMessages).sort((left, right) => left.createdAt - right.createdAt);

const runActivity = (state: OpenCodeThreadState, groups: readonly MessageGroup[]): RunActivity => ({
	lastGroupId: groups.findLast((group) => group.kind === "assistant")?.id,
	isActiveRun: isActiveRun(state),
});

/** The timing key for a group: its latest step (where streaming timing is recorded). */
const timingKey = (group: MessageGroup) => group.steps.at(-1)?.id ?? group.id;

export function projectOpenCodeThreadMessages(
	state: OpenCodeThreadState,
	messageTiming: Record<string, MessageTiming> = {},
): OpenCodeProjectedThreadMessage[] {
	const groups = groupMessages(visibleMessages(state));
	const activity = runActivity(state, groups);
	const server = groups.map((group) =>
		projectGroup(state, group, messageTiming[timingKey(group)], activity),
	);
	return mergeProjectedMessages(server, sortedPendingMessages(state).map(projectPendingMessage));
}

/*
 * Projection cache. A streamed token changes one message, but projecting
 * rebuilds every message from the whole thread state; without a cache every
 * ThreadMessage is new on every token and a token costs O(session). The cache
 * keeps a message's converted ThreadMessage while everything its projection
 * reads is unchanged by identity: its source messages, its timing, the run
 * activity its status reads, the thread's pending interactions, its subagent
 * calls' child sessions, and the local MCP app registry. Reducers replace the
 * objects they change, so identity is a sound key.
 */
interface ProjectionCacheEntry {
	readonly inputs: readonly unknown[];
	readonly message: ThreadMessage;
}

export interface OpenCodeProjectionCache {
	readonly server: Map<string, ProjectionCacheEntry>;
	readonly pending: WeakMap<PendingUserMessage, ThreadMessage>;
}

export const createOpenCodeProjectionCache = (): OpenCodeProjectionCache => ({
	server: new Map(),
	pending: new WeakMap(),
});

const sameInputs = (left: readonly unknown[], right: readonly unknown[]) =>
	left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

const toThreadMessage = (message: OpenCodeProjectedThreadMessage) =>
	ExportedMessageRepository.fromArray([message]).messages[0]!.message;

const projectionInputs = (
	state: OpenCodeThreadState,
	group: MessageGroup,
	timing: MessageTiming | undefined,
	activity: RunActivity,
): unknown[] => {
	const inputs: unknown[] = [...group.sources, timing];
	if (group.kind !== "assistant") return inputs;
	const isLatest = activity.lastGroupId === group.id;
	inputs.push(
		isLatest,
		isLatest && activity.isActiveRun,
		state.interactions.permissions,
		state.interactions.questions.pending,
		_localMcpApps,
	);
	for (const step of group.steps) {
		for (const item of step.content) {
			if (item.type !== "tool") continue;
			const childSessionId = getOpenCodeTaskSessionId(item);
			if (childSessionId) inputs.push(state.childSessionsById[childSessionId]);
		}
	}
	return inputs;
};

const projectCachedThreadMessages = (
	state: OpenCodeThreadState,
	messageTiming: Record<string, MessageTiming>,
	cache: OpenCodeProjectionCache,
): ThreadMessage[] => {
	const groups = groupMessages(visibleMessages(state));
	const activity = runActivity(state, groups);
	const seen = new Set<string>();
	const server: ThreadMessage[] = [];
	for (const group of groups) {
		seen.add(group.id);
		const timing = messageTiming[timingKey(group)];
		const inputs = projectionInputs(state, group, timing, activity);
		let entry = cache.server.get(group.id);
		if (!entry || !sameInputs(entry.inputs, inputs)) {
			entry = { inputs, message: toThreadMessage(projectGroup(state, group, timing, activity)) };
			cache.server.set(group.id, entry);
		}
		server.push(entry.message);
	}
	for (const id of cache.server.keys()) if (!seen.has(id)) cache.server.delete(id);
	const pending = sortedPendingMessages(state).map((message) => {
		let projected = cache.pending.get(message);
		if (!projected) {
			projected = toThreadMessage(projectPendingMessage(message));
			cache.pending.set(message, projected);
		}
		return projected;
	});
	return mergeProjectedMessages(
		server as unknown as OpenCodeProjectedThreadMessage[],
		pending as unknown as OpenCodeProjectedThreadMessage[],
	) as unknown as ThreadMessage[];
};

export function projectOpenCodeThreadRepository(
	state: OpenCodeThreadState,
	messageTiming: Record<string, MessageTiming> = {},
	cache?: OpenCodeProjectionCache,
): ExportedMessageRepository {
	if (!cache) {
		return ExportedMessageRepository.fromArray(projectOpenCodeThreadMessages(state, messageTiming));
	}
	const messages = projectCachedThreadMessages(state, messageTiming, cache);
	return {
		messages: messages.map((message, index) => ({
			parentId: index > 0 ? messages[index - 1]!.id : null,
			message,
		})),
	};
}
