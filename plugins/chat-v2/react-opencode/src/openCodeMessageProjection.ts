import type {
	AssistantMessage,
	Message,
	OpenCodeProjectedThreadMessage,
	OpenCodeServerMessage,
	OpenCodeThreadState,
	Part,
	PendingUserMessage,
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

const isAssistantMessage = (message: Message | undefined): message is AssistantMessage => {
	return message?.role === "assistant";
};

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

const mapToolState = (
	state:
		| {
				status?: string;
				input?: unknown;
				output?: unknown;
				error?: unknown;
		  }
		| null
		| undefined,
) => {
	const args = isRecord(state?.input) ? state.input : {};
	const argsText = JSON.stringify(args);

	if (state?.status === "completed") {
		return {
			args,
			argsText,
			result: state.output,
			isError: false,
		};
	}

	if (state?.status === "error") {
		return {
			args,
			argsText,
			result: state.error,
			isError: true,
		};
	}

	return {
		args,
		argsText,
		result: undefined,
		isError: false,
	};
};

const getPartToolCallId = (part: Part) => {
	if (part.type !== "tool") return undefined;
	return typeof part.callID === "string" ? part.callID : undefined;
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

const getPendingPermissionForToolCall = (state: OpenCodeThreadState, toolCallId: string) =>
	getPermissionIndex(state).pendingByCallId.get(toolCallId);

const getResolvedPermissionForToolCall = (state: OpenCodeThreadState, toolCallId: string) =>
	getPermissionIndex(state).resolvedByCallId.get(toolCallId);

const hasPendingInteractionForToolCall = (
	state: OpenCodeThreadState,
	toolCallId: string | undefined,
) => {
	if (!toolCallId) return false;

	// Kilo v2's forms name no tool call, so only permissions hold one up.
	return getPermissionIndex(state).pendingByCallId.has(toolCallId);
};

const hasPendingInteractionForMessage = (
	state: OpenCodeThreadState,
	message: OpenCodeServerMessage,
) => {
	for (const part of message.parts) {
		if (hasPendingInteractionForToolCall(state, getPartToolCallId(part))) {
			return true;
		}
	}

	return false;
};

const makeDataPart = (name: string, data: Record<string, unknown>, parentId?: string) => ({
	type: "data" as const,
	name,
	data,
	...(parentId ? { parentId } : {}),
});

const makeUnsupportedPart = (part: Part, parentId?: string) =>
	makeDataPart(
		"opencode-unsupported-part",
		{
			type: (part as { type?: string }).type ?? "unknown",
			part,
		},
		parentId,
	);

const sanitizeReasoningText = (text: string | undefined) =>
	(text ?? "")
		.replaceAll("[REDACTED]", "")
		.replaceAll("\\r\\n", "\n")
		.replaceAll("\\n", "\n")
		.replaceAll("\\t", "\t")
		.trim();

const convertFilePart = (part: Extract<Part, { type: "file" }>) => {
	const mimeType = part.mime ?? "application/octet-stream";
	if (mimeType.startsWith("image/")) {
		return {
			type: "image" as const,
			image: part.url ?? "",
			...(part.filename ? { filename: part.filename } : {}),
		};
	}

	return {
		type: "file" as const,
		filename: part.filename ?? "file",
		data: part.url ?? "",
		mimeType,
	};
};

const projectAssistantContent = (
	state: OpenCodeThreadState,
	message: OpenCodeServerMessage,
): ProjectedContentPart[] => {
	const content: ProjectedContentPart[] = [];
	const stepStack: string[] = [];

	const currentStepId = () => stepStack[stepStack.length - 1];

	for (const [index, part] of message.parts.entries()) {
		switch (part.type) {
			case "text": {
				const text = part.text ?? "";
				// Kilo's synthetic text parts are server-side context, not reply text:
				// a transient "Initializing snapshot" notice shows as progress while
				// the message runs, and the rest stays hidden.
				if (part.synthetic) {
					const info = message.info as { finish?: unknown; error?: unknown } | undefined;
					if (info?.finish || info?.error) break;
					if (
						part.metadata?.["kilocode.lifecycle"] === "transient" &&
						text.includes("Initializing snapshot")
					) {
						content.push(makeDataPart("opencode-snapshot-progress", { text }, currentStepId()));
						break;
					}
				}
				content.push({ type: "text", text });
				break;
			}

			case "reasoning":
				{
					const text = sanitizeReasoningText(part.text);
					if (!text) break;
					content.push({
						type: "reasoning",
						text,
						...(currentStepId() ? { parentId: currentStepId() } : {}),
					});
				}
				break;

			case "file":
				content.push(convertFilePart(part));
				break;

			case "tool": {
				const toolState = mapToolState(part.state);
				const toolCallId = part.callID ?? part.id ?? `tool-${index}`;
				const toolName = part.tool ?? "tool";
				const childSessionId = getOpenCodeTaskSessionId(part);
				const childState = childSessionId ? state.childSessionsById[childSessionId] : undefined;
				const childMessages =
					childState?.loadState.type === "ready" ? getChildMessages(childState) : undefined;
				const permission = getPendingPermissionForToolCall(state, toolCallId);
				const resolvedPermission = permission
					? undefined
					: getResolvedPermissionForToolCall(state, toolCallId);
				const localApp = _localMcpApps[toolName];
				const metadataMcpApp = (part.state as { metadata?: Record<string, unknown> } | undefined)
					?.metadata?.["mcpApp"] as { resourceUri: string; serverId?: string } | undefined;
				const mcpAppMeta = localApp
					? {
							mcp: {
								app: {
									resourceUri: localApp.resourceUri,
									serverId: localApp.serverId,
								},
							},
						}
					: metadataMcpApp
						? {
								mcp: {
									app: {
										resourceUri: metadataMcpApp.resourceUri,
										...(metadataMcpApp.serverId !== undefined
											? { serverId: metadataMcpApp.serverId }
											: {}),
									},
								},
							}
						: {};
				content.push({
					type: "tool-call",
					toolCallId,
					toolName,
					args: toolState.args as never,
					argsText: toolState.argsText,
					...(toolState.result !== undefined ? { result: toolState.result } : {}),
					...(toolState.isError ? { isError: true } : {}),
					...(childMessages !== undefined ? { messages: childMessages } : {}),
					...(permission
						? { approval: projectOpenCodePermissionApproval(permission) }
						: resolvedPermission
							? {
									approval: projectResolvedOpenCodePermissionApproval(resolvedPermission),
								}
							: {}),
					...mcpAppMeta,
					...(currentStepId() ? { parentId: currentStepId() } : {}),
				});
				break;
			}

			case "step-start": {
				const nestedParentId = currentStepId();
				const stepId =
					("id" in part && typeof part.id === "string" ? part.id : undefined) ?? `step-${index}`;
				stepStack.push(stepId);
				content.push(
					makeDataPart(
						"opencode-step-start",
						{
							id: stepId,
							depth: stepStack.length - 1,
							snapshot:
								"snapshot" in part && typeof part.snapshot === "string" ? part.snapshot : undefined,
						},
						nestedParentId,
					),
				);
				break;
			}

			case "step-finish": {
				const stepId =
					stepStack.pop() ??
					("id" in part && typeof part.id === "string" ? part.id : undefined) ??
					`step-finish-${index}`;
				content.push(
					makeDataPart("opencode-step-finish", {
						id: stepId,
						reason: "reason" in part ? part.reason : undefined,
						cost: "cost" in part ? part.cost : undefined,
						snapshot:
							"snapshot" in part && typeof part.snapshot === "string" ? part.snapshot : undefined,
					}),
				);
				break;
			}

			case "patch":
				content.push(
					makeDataPart(
						"opencode-patch",
						{
							id:
								("id" in part && typeof part.id === "string" ? part.id : undefined) ??
								`patch-${index}`,
							hash: "hash" in part ? part.hash : undefined,
							files: Array.isArray((part as { files?: unknown[] }).files)
								? (part as { files: unknown[] }).files.filter(
										(file): file is string => typeof file === "string",
									)
								: [],
							part,
						},
						currentStepId(),
					),
				);
				break;

			case "snapshot":
				content.push(
					makeDataPart(
						"opencode-snapshot",
						{
							id:
								("id" in part && typeof part.id === "string" ? part.id : undefined) ??
								`snapshot-${index}`,
							part,
						},
						currentStepId(),
					),
				);
				break;

			case "retry":
			case "compaction":
			case "agent":
			case "subtask":
				content.push(
					makeDataPart(
						`opencode-${part.type}`,
						{
							id:
								("id" in part && typeof part.id === "string" ? part.id : undefined) ??
								`${part.type}-${index}`,
							part,
						},
						currentStepId(),
					),
				);
				break;

			default:
				content.push(makeUnsupportedPart(part, currentStepId()));
				break;
		}
	}

	return content;
};

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
		// reconciled server copy agree on the attachment's type and content type.
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

const projectUserFileAttachment = (part: Extract<Part, { type: "file" }>): ProjectedAttachment => {
	const content = convertFilePart(part);
	return {
		id: part.id,
		type: content.type === "image" ? "image" : "file",
		name: part.filename ?? "file",
		contentType: part.mime ?? "application/octet-stream",
		status: { type: "complete" },
		content: [content],
	};
};

const projectUserMessage = (
	message: OpenCodeServerMessage,
): { content: ProjectedContentPart[]; attachments: ProjectedAttachment[] } => {
	if (message.parts.length === 0) {
		return splitUserParts(message.shadowParts ?? []);
	}

	const content: ProjectedContentPart[] = [];
	const attachments: ProjectedAttachment[] = [];
	for (const part of message.parts) {
		if (part.type === "text") {
			if (part.synthetic) continue;
			content.push({ type: "text", text: part.text ?? "" });
		} else if (part.type === "file") {
			attachments.push(projectUserFileAttachment(part));
		}
	}
	return { content, attachments };
};

const CANCELLED_STATUS = { type: "incomplete", reason: "cancelled" } as const;

// A turn only ends on a model reply; one whose last step handed off to tools
// was halted before the next step (Stop kills subagents first, so their task
// calls fail and the step closes cleanly). A completed plan_exit is the one
// tool that ends a turn by design, mirroring the server's continuation check.
const endsBetweenSteps = (message: OpenCodeServerMessage): boolean =>
	message.info !== undefined &&
	"finish" in message.info &&
	message.info.finish === "tool-calls" &&
	!message.parts.some(
		(part) =>
			part.type === "tool" && part.tool === "plan_exit" && part.state?.status === "completed",
	);

/** What every message's status reads about the run, computed once per projection. */
interface RunActivity {
	readonly lastAssistantId: string | undefined;
	readonly isActiveRun: boolean;
}

const getRunActivity = (state: OpenCodeThreadState): RunActivity => ({
	lastAssistantId: state.messageOrder.findLast(
		(messageId) => state.messagesById[messageId]?.info?.role === "assistant",
	),
	isActiveRun:
		state.runState.type === "streaming" ||
		state.runState.type === "cancelling" ||
		state.runState.type === "reverting" ||
		state.sessionStatus?.type === "busy" ||
		state.sessionStatus?.type === "retry",
});

const getMessageStatus = (
	state: OpenCodeThreadState,
	message: OpenCodeServerMessage,
	activity: RunActivity = getRunActivity(state),
): OpenCodeProjectedThreadMessage["status"] => {
	if (!isAssistantMessage(message.info)) {
		return undefined;
	}

	if (hasPendingInteractionForMessage(state, message)) {
		return {
			type: "requires-action",
			reason: "tool-calls",
		};
	}

	if (message.info.error) {
		const error = message.info.error;
		if (isRecord(error) && error.name === "MessageAbortedError") {
			return CANCELLED_STATUS;
		}
		const maybeMessage =
			isRecord(error) && isRecord(error.data) && typeof error.data.message === "string"
				? error.data.message
				: undefined;
		const fallbackMessage =
			typeof error === "string"
				? error
				: isRecord(error) && typeof error.name === "string"
					? error.name
					: "OpenCode run failed";

		return {
			type: "incomplete",
			reason: "error",
			error: maybeMessage ?? fallbackMessage,
		};
	}

	const isActiveMessage = activity.lastAssistantId === message.id;
	const { isActiveRun } = activity;

	if (!message.info.finish) {
		if (!isActiveMessage || !isActiveRun) return CANCELLED_STATUS;
		return {
			type: "running",
		};
	}

	// Only the latest turn: an earlier assistant message can legitimately end
	// on tool calls when a queued user message took over the loop.
	if (isActiveMessage && !isActiveRun && endsBetweenSteps(message)) {
		return CANCELLED_STATUS;
	}

	return {
		type: "complete",
		reason: "stop",
	};
};

/**
 * One transcript message: a user message, or a run of assistant steps.
 * `id` is the first step's id, so the projected message keeps its identity
 * (React key, cache entry, disclosure state) as later steps join the run;
 * `message` carries the latest step's id, which status, timing and the
 * server read.
 */
interface ServerMessageGroup {
	readonly id: string;
	readonly sources: readonly OpenCodeServerMessage[];
	readonly message: OpenCodeServerMessage;
}

const isBackgroundUserMessage = (message: OpenCodeServerMessage) =>
	message.info?.role === "user" &&
	message.parts.some(
		(part) => part.type === "text" && part.synthetic === true && part.metadata?.background === true,
	);

// Kilo-only context with nothing the person wrote (a fork's handoff note):
// projected, it would be an empty bubble with its own actions.
const isHiddenUserMessage = (message: OpenCodeServerMessage) =>
	message.info?.role === "user" &&
	message.parts.length > 0 &&
	message.parts.every((part) => part.type === "text" && part.synthetic === true);

const mergeAssistantSteps = (steps: readonly OpenCodeServerMessage[]): OpenCodeServerMessage => {
	if (steps.length === 1) return steps[0]!;
	const first = steps[0]!;
	const last = steps[steps.length - 1]!;
	const hasShadowParts = steps.some((step) => step.shadowParts);
	return {
		id: last.id,
		info: {
			...last.info!,
			time: {
				...last.info!.time,
				created: first.info!.time?.created ?? last.info!.time?.created,
			},
		} as OpenCodeServerMessage["info"],
		parts: steps.flatMap((step) => step.parts),
		shadowParts: hasShadowParts ? steps.flatMap((step) => step.shadowParts ?? []) : undefined,
	};
};

const groupServerMessages = (messages: readonly OpenCodeServerMessage[]): ServerMessageGroup[] => {
	const groups: OpenCodeServerMessage[][] = [];
	for (const message of messages) {
		if (isBackgroundUserMessage(message) || isHiddenUserMessage(message)) continue;
		const previous = groups[groups.length - 1];
		if (previous?.[0]?.info?.role === "assistant" && message.info?.role === "assistant") {
			previous.push(message);
			continue;
		}
		groups.push([message]);
	}
	return groups.map((sources) => ({
		id: sources[0]!.id,
		sources,
		message: sources[0]?.info?.role === "assistant" ? mergeAssistantSteps(sources) : sources[0]!,
	}));
};

const projectServerMessage = (
	state: OpenCodeThreadState,
	id: string,
	message: OpenCodeServerMessage,
	timing: MessageTiming | undefined,
	activity: RunActivity,
): OpenCodeProjectedThreadMessage | null => {
	if (!message.info) return null;

	const metadata = {
		custom: {
			opencode: {
				originalMessage: message.info,
				parts: message.parts,
			},
		},
	};

	if (message.info.role === "assistant") {
		const assistantInfo = message.info as AssistantMessage;
		return {
			id,
			role: "assistant",
			createdAt: new Date(message.info.time?.created ?? Date.now()),
			content: projectAssistantContent(state, message),
			status: getMessageStatus(state, message, activity),
			metadata: {
				custom: {
					...metadata.custom,
					modelID: assistantInfo.modelID,
					providerID: assistantInfo.providerID,
					cost: assistantInfo.cost,
					tokens: assistantInfo.tokens,
					mode: assistantInfo.mode,
				},
				...(timing && { timing }),
			},
		};
	}

	if (message.info.role === "user") {
		const { content, attachments } = projectUserMessage(message);
		return {
			id,
			role: "user",
			createdAt: new Date(message.info.time?.created ?? Date.now()),
			content,
			attachments,
			metadata,
		};
	}

	return null;
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

type SessionRevert = NonNullable<OpenCodeThreadState["session"]>["revert"];

const applyRevertVisibility = (
	messages: readonly OpenCodeServerMessage[],
	revert: SessionRevert,
): OpenCodeServerMessage[] => {
	if (!revert?.messageID) return [...messages];
	return messages.flatMap((message) => {
		if (message.id < revert.messageID) return [message];
		if (message.id !== revert.messageID || !revert.partID) return [];
		const boundaryIndex = message.parts.findIndex((part) => part.id === revert.partID);
		return [
			{
				...message,
				parts: boundaryIndex < 0 ? [] : message.parts.slice(0, boundaryIndex),
			},
		];
	});
};

const visibleServerMessages = (state: OpenCodeThreadState) =>
	applyRevertVisibility(
		state.messageOrder.flatMap((messageId: string) => {
			const message = state.messagesById[messageId];
			return message ? [message] : [];
		}),
		state.session?.revert,
	);

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
		.map(({ id, message }) =>
			projectServerMessage(state, id, message, messageTiming[message.id], activity),
		)
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
	if (message.info?.role !== "assistant") return inputs;
	// Status reads the run's activity only for the turn's latest message.
	const isActiveMessage = activity.lastAssistantId === message.id;
	inputs.push(
		isActiveMessage,
		isActiveMessage && activity.isActiveRun,
		state.interactions.permissions,
		state.interactions.questions.pending,
		_localMcpApps,
	);
	for (const part of message.parts) {
		const childSessionId = getOpenCodeTaskSessionId(part);
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
			const projected = projectServerMessage(state, id, group.message, timing, activity);
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
