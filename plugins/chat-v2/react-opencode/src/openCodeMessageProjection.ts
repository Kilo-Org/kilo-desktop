import type {
	KiloAssistantContent,
	KiloToolCall,
	OpenCodeProjectedThreadMessage,
	OpenCodeServerMessage,
	OpenCodeThreadState,
	PendingUserMessage,
	SessionMessageAssistant,
	SessionMessageCompaction,
	SessionMessageShell,
	SessionMessageUser,
	ThreadUserMessagePart,
} from "./types";
import {
	ExportedMessageRepository,
	type MessageTiming,
	type ThreadMessage,
} from "@assistant-ui/react";
import { resolveFileMediaType, resolveImageMediaType } from "@assistant-ui/core/internal";
import {
	projectOpenCodePermissionApproval,
	projectResolvedOpenCodePermissionApproval,
} from "./openCodePermissionApproval";
import { getOpenCodeTaskSessionId } from "./openCodeTaskSession";

/*
 * Kilo v2's transcript as assistant-ui messages. A user message is one
 * message; a run of assistant steps (and composer shell runs) between user
 * messages is one assistant message, each step's text, reasoning and tool
 * calls in order under a step marker; a compaction is its own assistant
 * message (a "Compaction" marker, then its summary). Hidden notes, system
 * text, skills, the agent/model/location markers and a turn's idle marker are
 * Kilo's context, not the conversation: not shown, and a run goes on past
 * them (a background task's note starts a turn that continues the reply).
 *
 * What the chat reads raw rides along as `metadata.custom.opencode`: the Kilo
 * v2 messages a projected message stands for (`messages`) and the latest of
 * them (`message`).
 */

type ProjectedContentPart = Exclude<OpenCodeProjectedThreadMessage["content"], string>[number];

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

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

const getProjectedCreatedAt = (message: OpenCodeProjectedThreadMessage) => {
	return message.createdAt instanceof Date ? message.createdAt.getTime() : Date.now();
};

const compareProjectedMessages = (
	left: OpenCodeProjectedThreadMessage,
	right: OpenCodeProjectedThreadMessage,
) => {
	const leftTime = getProjectedCreatedAt(left);
	const rightTime = getProjectedCreatedAt(right);
	if (leftTime !== rightTime) return leftTime - rightTime;
	return left.id?.localeCompare(right.id ?? "") ?? 0;
};

const mergeProjectedMessages = (
	serverMessages: readonly OpenCodeProjectedThreadMessage[],
	pendingMessages: readonly OpenCodeProjectedThreadMessage[],
) => {
	const merged: OpenCodeProjectedThreadMessage[] = [];
	let serverIndex = 0;
	let pendingIndex = 0;

	while (serverIndex < serverMessages.length && pendingIndex < pendingMessages.length) {
		const serverMessage = serverMessages[serverIndex]!;
		const pendingMessage = pendingMessages[pendingIndex]!;

		if (compareProjectedMessages(serverMessage, pendingMessage) <= 0) {
			merged.push(serverMessage);
			serverIndex += 1;
		} else {
			merged.push(pendingMessage);
			pendingIndex += 1;
		}
	}

	return [...merged, ...serverMessages.slice(serverIndex), ...pendingMessages.slice(pendingIndex)];
};

/** A tool call's text output (its content's text items), as the chat shows a result. */
export const toolCallOutput = (tool: KiloToolCall): string | undefined => {
	const content =
		tool.state.status === "completed" || tool.state.status === "error"
			? tool.state.content
			: undefined;
	if (!content) return undefined;
	return content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
};

const mapToolState = (tool: KiloToolCall) => {
	const { state } = tool;
	const args = state.status !== "streaming" && isRecord(state.input) ? state.input : {};
	const argsText = JSON.stringify(args);
	if (state.status === "completed") {
		return { args, argsText, result: toolCallOutput(tool) ?? "", isError: false };
	}
	if (state.status === "error") {
		return { args, argsText, result: state.error.message, isError: true };
	}
	return { args, argsText, result: undefined, isError: false };
};

type PermissionState = OpenCodeThreadState["interactions"]["permissions"];
type PendingPermission = PermissionState["pending"][string];
type ResolvedPermission = PermissionState["resolved"][string];

type PermissionIndex = {
	pendingByCallId: ReadonlyMap<string, PendingPermission>;
	resolvedByCallId: ReadonlyMap<string, ResolvedPermission>;
};

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
		const callId = entry.request.source?.id;
		if (callId) resolvedByCallId.set(callId, entry);
	}

	const index: PermissionIndex = { pendingByCallId, resolvedByCallId };
	permissionIndexCache.set(permissions, index);
	return index;
};

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

const toolCallsOf = (messages: readonly OpenCodeServerMessage[]): KiloToolCall[] =>
	messages.flatMap((message) =>
		message.type === "assistant"
			? message.content.filter((item): item is KiloToolCall => item.type === "tool")
			: [],
	);

const hasPendingInteraction = (
	state: OpenCodeThreadState,
	messages: readonly OpenCodeServerMessage[],
) => {
	// Kilo v2's forms name no tool call, so only permissions hold one up.
	const { pendingByCallId } = getPermissionIndex(state);
	if (pendingByCallId.size === 0) return false;
	return toolCallsOf(messages).some((tool) => pendingByCallId.has(tool.id));
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

const mcpAppOf = (tool: KiloToolCall) => {
	const localApp = _localMcpApps[tool.name];
	if (localApp) {
		return { mcp: { app: { resourceUri: localApp.resourceUri, serverId: localApp.serverId } } };
	}
	const metadata = tool.state.status === "streaming" ? undefined : tool.state.metadata;
	const app = metadata?.["mcpApp"] as { resourceUri: string; serverId?: string } | undefined;
	if (!app) return {};
	return {
		mcp: {
			app: {
				resourceUri: app.resourceUri,
				...(app.serverId !== undefined ? { serverId: app.serverId } : {}),
			},
		},
	};
};

const projectToolCall = (
	state: OpenCodeThreadState,
	tool: KiloToolCall,
	parentId: string,
): ProjectedContentPart => {
	const toolState = mapToolState(tool);
	const childSessionId = getOpenCodeTaskSessionId(tool);
	const childState = childSessionId ? state.childSessionsById[childSessionId] : undefined;
	const childMessages =
		childState?.loadState.type === "ready" ? getChildMessages(childState) : undefined;
	const { pendingByCallId, resolvedByCallId } = getPermissionIndex(state);
	const permission = pendingByCallId.get(tool.id);
	const resolvedPermission = permission ? undefined : resolvedByCallId.get(tool.id);
	return {
		type: "tool-call",
		toolCallId: tool.id,
		toolName: tool.name || "tool",
		args: toolState.args as never,
		argsText: toolState.argsText,
		...(toolState.result !== undefined ? { result: toolState.result } : {}),
		...(toolState.isError ? { isError: true } : {}),
		...(childMessages !== undefined ? { messages: childMessages } : {}),
		...(permission
			? { approval: projectOpenCodePermissionApproval(permission) }
			: resolvedPermission
				? { approval: projectResolvedOpenCodePermissionApproval(resolvedPermission) }
				: {}),
		...mcpAppOf(tool),
		parentId,
	};
};

const projectContentItem = (
	state: OpenCodeThreadState,
	item: KiloAssistantContent,
	stepId: string,
): ProjectedContentPart | undefined => {
	switch (item.type) {
		case "text":
			return { type: "text", text: item.text };
		case "reasoning": {
			const text = sanitizeReasoningText(item.text);
			return text ? { type: "reasoning", text, parentId: stepId } : undefined;
		}
		case "tool":
			return projectToolCall(state, item, stepId);
	}
};

/** One step: its marker, its content, and (once it ends) its finish with usage and snapshot. */
const projectStep = (
	state: OpenCodeThreadState,
	message: SessionMessageAssistant,
): ProjectedContentPart[] => {
	const content: ProjectedContentPart[] = [
		makeDataPart("opencode-step-start", {
			id: message.id,
			depth: 0,
			snapshot: message.snapshot?.start,
		}),
	];
	for (const item of message.content) {
		const part = projectContentItem(state, item, message.id);
		if (part) content.push(part);
	}
	if (message.retry && message.time.completed === undefined) {
		content.push(
			makeDataPart("opencode-retry", { id: `${message.id}:retry`, ...message.retry }, message.id),
		);
	}
	if (message.time.completed !== undefined) {
		content.push(
			makeDataPart("opencode-step-finish", {
				id: message.id,
				reason: message.finish,
				cost: message.cost,
				tokens: message.tokens,
				snapshot: message.snapshot?.end,
				files: message.snapshot?.files,
			}),
		);
	}
	return content;
};

/** A composer shell run, shown as the `shell` tool call it is. */
const projectShell = (message: SessionMessageShell): ProjectedContentPart => ({
	type: "tool-call",
	toolCallId: message.shellID,
	toolName: "shell",
	args: { command: message.command } as never,
	argsText: JSON.stringify({ command: message.command }),
	...(message.status !== "running" ? { result: message.output?.output ?? "" } : {}),
});

const projectRunContent = (
	state: OpenCodeThreadState,
	messages: readonly OpenCodeServerMessage[],
): ProjectedContentPart[] =>
	messages.flatMap((message) => {
		if (message.type === "assistant") return projectStep(state, message);
		if (message.type === "shell") return [projectShell(message)];
		return [];
	});

const projectCompactionContent = (message: SessionMessageCompaction): ProjectedContentPart[] => [
	makeDataPart("opencode-compaction", {
		id: message.id,
		status: message.status,
		reason: message.reason,
		...(message.status === "failed" ? { error: message.error.message } : {}),
	}),
	...(message.status === "completed" && message.summary
		? [{ type: "text" as const, text: message.summary }]
		: []),
];

type ProjectedAttachment = NonNullable<OpenCodeProjectedThreadMessage["attachments"]>[number];

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
		// server's copy agree on the attachment's type and content type.
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

type UserFile = NonNullable<SessionMessageUser["files"]>[number];

/** A prompt's attached file: its bytes inline as a data URL. */
export const userFileUrl = (file: UserFile) => `data:${file.mime};base64,${file.data}`;

const projectUserFile = (file: UserFile, index: number): ProjectedAttachment => {
	const url = userFileUrl(file);
	const image = file.mime.startsWith("image/");
	return {
		id: index.toString(),
		type: image ? "image" : "file",
		name: file.name ?? "file",
		contentType: file.mime,
		status: { type: "complete" },
		content: [
			image
				? { type: "image", image: url, ...(file.name ? { filename: file.name } : {}) }
				: { type: "file", filename: file.name ?? "file", data: url, mimeType: file.mime },
		],
	};
};

const projectUserMessage = (message: SessionMessageUser) => ({
	content: [{ type: "text" as const, text: message.text }],
	attachments: (message.files ?? []).map(projectUserFile),
});

const CANCELLED_STATUS = { type: "incomplete", reason: "cancelled" } as const;

// A turn only ends on a model reply; one whose last step handed off to tools
// was halted before the next step (Stop kills subagents first, so their
// subagent calls fail and the step closes cleanly). A completed plan_exit is
// the one tool that ends a turn by design, mirroring the server's
// continuation check.
const endsBetweenSteps = (message: SessionMessageAssistant): boolean =>
	message.finish === "tool-calls" &&
	!message.content.some(
		(item) =>
			item.type === "tool" && item.name === "plan_exit" && item.state.status === "completed",
	);

const isInterruption = (type: string) => /abort|interrupt|cancel/i.test(type);

/** What every message's status reads about the run, computed once per projection. */
interface RunActivity {
	readonly lastRunId: string | undefined;
	readonly isActiveRun: boolean;
}

const RUN_TYPES: ReadonlySet<string> = new Set(["assistant", "shell", "compaction"]);

const getRunActivity = (state: OpenCodeThreadState): RunActivity => ({
	lastRunId: state.messageOrder.findLast((messageId) =>
		RUN_TYPES.has(state.messagesById[messageId]?.type ?? ""),
	),
	isActiveRun:
		state.runState.type === "streaming" ||
		state.runState.type === "cancelling" ||
		state.runState.type === "reverting" ||
		state.sessionStatus?.type === "busy" ||
		state.sessionStatus?.type === "retry",
});

const RUNNING_STATUS = { type: "running" } as const;
const COMPLETE_STATUS = { type: "complete", reason: "stop" } as const;

const getMessageStatus = (
	state: OpenCodeThreadState,
	group: ServerMessageGroup,
	activity: RunActivity,
): OpenCodeProjectedThreadMessage["status"] => {
	const { message } = group;
	if (hasPendingInteraction(state, group.sources)) {
		return { type: "requires-action", reason: "tool-calls" };
	}
	const isLive = activity.lastRunId === message.id && activity.isActiveRun;

	if (message.type === "shell")
		return message.status === "running" && isLive ? RUNNING_STATUS : COMPLETE_STATUS;
	if (message.type === "compaction") {
		if (message.status === "failed") {
			return { type: "incomplete", reason: "error", error: message.error.message };
		}
		return message.status === "running"
			? isLive
				? RUNNING_STATUS
				: CANCELLED_STATUS
			: COMPLETE_STATUS;
	}
	if (message.type !== "assistant") return undefined;

	if (message.error) {
		if (isInterruption(message.error.type)) return CANCELLED_STATUS;
		return {
			type: "incomplete",
			reason: "error",
			error: message.error.message || message.error.type || "Kilo run failed",
		};
	}

	if (message.time.completed === undefined && !message.finish) {
		return isLive ? RUNNING_STATUS : CANCELLED_STATUS;
	}

	// Only the latest turn: an earlier assistant message can legitimately end
	// on tool calls when a queued user message took over the loop.
	if (activity.lastRunId === message.id && !activity.isActiveRun && endsBetweenSteps(message)) {
		return CANCELLED_STATUS;
	}

	return COMPLETE_STATUS;
};

/**
 * One transcript message: a user message, a compaction, or a run of
 * assistant steps and shell runs. `id` is the first source's id, so the
 * projected message keeps its identity (React key, cache entry, disclosure
 * state) as later steps join the run; `message` is the latest source, which
 * status and timing read.
 */
interface ServerMessageGroup {
	readonly id: string;
	readonly sources: readonly OpenCodeServerMessage[];
	readonly message: OpenCodeServerMessage;
}

const isRunMessage = (message: OpenCodeServerMessage) =>
	message.type === "assistant" || message.type === "shell";

const groupServerMessages = (messages: readonly OpenCodeServerMessage[]): ServerMessageGroup[] => {
	const groups: OpenCodeServerMessage[][] = [];
	let runOpen = false;
	for (const message of messages) {
		if (isRunMessage(message)) {
			if (runOpen) groups[groups.length - 1]!.push(message);
			else groups.push([message]);
			runOpen = true;
			continue;
		}
		if (message.type === "user" || message.type === "compaction") {
			groups.push([message]);
			runOpen = false;
		}
		// Notes, system text, skills, markers and idle markers are Kilo's context: not shown.
	}
	return groups.map((sources) => ({
		id: sources[0]!.id,
		sources,
		message: sources[sources.length - 1]!,
	}));
};

/** The usage the chat reads from the latest step of a run. */
const assistantCustom = (group: ServerMessageGroup) => {
	const step = group.sources.findLast(
		(source): source is SessionMessageAssistant => source.type === "assistant",
	);
	if (!step) return {};
	return {
		modelID: step.model.id,
		providerID: step.model.providerID,
		cost: step.cost,
		tokens: step.tokens,
		agent: step.agent,
	};
};

const projectServerMessage = (
	state: OpenCodeThreadState,
	group: ServerMessageGroup,
	timing: MessageTiming | undefined,
	activity: RunActivity,
): OpenCodeProjectedThreadMessage | null => {
	const { id, sources, message } = group;
	const opencode = { message, messages: sources };
	const createdAt = new Date(sources[0]!.time.created);

	if (message.type === "user") {
		return {
			id,
			role: "user",
			createdAt,
			...projectUserMessage(message),
			metadata: { custom: { opencode } },
		};
	}

	const content =
		message.type === "compaction"
			? projectCompactionContent(message)
			: projectRunContent(state, sources);
	return {
		id,
		role: "assistant",
		createdAt,
		content,
		status: getMessageStatus(state, group, activity),
		metadata: {
			custom: { opencode, ...assistantCustom(group) },
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

/** Messages from the session's revert boundary on are undone: not shown while the revert stands. */
const visibleServerMessages = (state: OpenCodeThreadState): OpenCodeServerMessage[] => {
	const messages = state.messageOrder.flatMap((messageId: string) => {
		const message = state.messagesById[messageId];
		return message ? [message] : [];
	});
	const boundary = state.session?.revert?.messageID;
	if (!boundary) return messages;
	const at = messages.findIndex((message) => message.id === boundary);
	return at >= 0 ? messages.slice(0, at) : messages.filter((message) => message.id < boundary);
};

const sortedPendingMessages = (state: OpenCodeThreadState) =>
	(Object.values(state.pendingUserMessages) as PendingUserMessage[]).sort(
		(left, right) => left.createdAt - right.createdAt,
	);

export function projectOpenCodeThreadMessages(
	state: OpenCodeThreadState,
	messageTiming: Record<string, MessageTiming> = {},
): OpenCodeProjectedThreadMessage[] {
	const activity = getRunActivity(state);
	const serverMessages = groupServerMessages(visibleServerMessages(state))
		.map((group) => projectServerMessage(state, group, messageTiming[group.message.id], activity))
		.filter((message): message is OpenCodeProjectedThreadMessage => message !== null);

	const pendingMessages = sortedPendingMessages(state).map(projectPendingMessage);

	return mergeProjectedMessages(serverMessages, pendingMessages);
}

/*
 * Projection cache. A streamed token changes one part of one message, but
 * projecting rebuilds every message from the whole thread state; without a
 * cache every ThreadMessage is new on every token, so every message's
 * components render again and a token costs O(session). The cache keeps a
 * message's converted ThreadMessage while everything its projection reads is
 * unchanged by identity: its source server messages, its timing, the run
 * activity its status reads, the thread's pending interactions, its task
 * tools' child sessions, and the local MCP app registry. Reducers replace the
 * objects they change, so identity is a sound key. Entries live as long as
 * the cache (one per runtime) and are dropped once their message is gone.
 */
interface ProjectionCacheEntry {
	readonly inputs: readonly unknown[];
	readonly message: ThreadMessage | null;
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
	group: ServerMessageGroup,
	timing: MessageTiming | undefined,
	activity: RunActivity,
): unknown[] => {
	const { message } = group;
	const inputs: unknown[] = [...group.sources, timing];
	if (message.type === "user") return inputs;
	// Status reads the run's activity only for the turn's latest message.
	const isActiveMessage = activity.lastRunId === message.id;
	inputs.push(
		isActiveMessage,
		isActiveMessage && activity.isActiveRun,
		state.interactions.permissions,
		state.interactions.questions.pending,
		_localMcpApps,
	);
	for (const tool of toolCallsOf(group.sources)) {
		const childSessionId = getOpenCodeTaskSessionId(tool);
		if (childSessionId) inputs.push(state.childSessionsById[childSessionId]);
	}
	return inputs;
};

const projectCachedThreadMessages = (
	state: OpenCodeThreadState,
	messageTiming: Record<string, MessageTiming>,
	cache: OpenCodeProjectionCache,
): ThreadMessage[] => {
	const activity = getRunActivity(state);
	const seen = new Set<string>();
	const serverMessages: ThreadMessage[] = [];
	for (const group of groupServerMessages(visibleServerMessages(state))) {
		const { id } = group;
		seen.add(id);
		const timing = messageTiming[group.message.id];
		const inputs = projectionInputs(state, group, timing, activity);
		let entry = cache.server.get(id);
		if (!entry || !sameInputs(entry.inputs, inputs)) {
			const projected = projectServerMessage(state, group, timing, activity);
			entry = { inputs, message: projected ? toThreadMessage(projected) : null };
			cache.server.set(id, entry);
		}
		if (entry.message) serverMessages.push(entry.message);
	}
	for (const id of cache.server.keys()) if (!seen.has(id)) cache.server.delete(id);

	const pendingMessages = sortedPendingMessages(state).map((pending) => {
		let message = cache.pending.get(pending);
		if (!message) {
			message = toThreadMessage(projectPendingMessage(pending));
			cache.pending.set(pending, message);
		}
		return message;
	});

	return mergeProjectedMessages(
		serverMessages as unknown as OpenCodeProjectedThreadMessage[],
		pendingMessages as unknown as OpenCodeProjectedThreadMessage[],
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
