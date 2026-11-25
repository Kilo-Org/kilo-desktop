import type { DomainObjectEventName, DomainObjectEventPayload } from "@kilo-desktop/kernel";
import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";

import {
	hasKiloDesktopSessionMetadata,
	readWorkSessionIdFromMetadata,
	readWorkspaceFoldersFromMetadata,
	readWorkspaceIdFromMetadata,
	readWorktreeBranchFromMetadata,
	type ChatActivity,
	type ChatError,
	type ChatStatus,
	type ChatSummary,
	type Chats,
} from "../../../contracts";

/**
 * Chat activity as pure functions over every chat the server has mentioned —
 * this app's, other clients' and chats known only from an event — ported from
 * origin's session-activity logic. What other plugins see is `publishChats`:
 * this app's root chats and their subagents.
 */

export type ChatActivityState = ChatActivity;
export type { ChatActivity };

/** A Kilo session as the conversations area reads it; its directory is its location's. */
export interface ChatInfo {
	readonly id: string;
	readonly title: string;
	readonly parentId: string | null;
	readonly directory: string | null;
	readonly metadata: unknown;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly archivedAt?: number;
}

export interface ChatRecord {
	readonly info?: ChatInfo;
	readonly activity: ChatActivity;
	/** The directory the server's events about this chat came from. */
	readonly directory?: string;
}

export type ChatRecords = Readonly<Record<string, ChatRecord>>;

export const IDLE: ChatActivity = {
	status: "idle",
	pendingPermissionIds: [],
	pendingQuestionIds: [],
};

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const asStatus = (value: unknown): ChatStatus | undefined =>
	value === "busy" || value === "retry" || value === "idle" ? value : undefined;

const isWorking = (status: ChatStatus | undefined) => status === "busy" || status === "retry";

export function needsAttention(activity: ChatActivity): boolean {
	return activity.pendingPermissionIds.length > 0 || activity.pendingQuestionIds.length > 0;
}

export function readChatInfo(session: SessionInfo): ChatInfo {
	return {
		id: session.id,
		title: session.title ?? "",
		parentId: session.parentID ?? null,
		directory: session.location.directory,
		metadata: session.metadata ?? null,
		createdAt: session.time.created,
		updatedAt: session.time.updated,
		...(session.time.archived !== undefined ? { archivedAt: session.time.archived } : {}),
	};
}

export function sameInfo(a: ChatInfo | undefined, b: ChatInfo): boolean {
	return (
		a !== undefined &&
		a.title === b.title &&
		a.parentId === b.parentId &&
		a.directory === b.directory &&
		a.createdAt === b.createdAt &&
		a.updatedAt === b.updatedAt &&
		a.archivedAt === b.archivedAt &&
		JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
	);
}

function withRecord(
	chats: ChatRecords,
	chatId: string,
	change: (record: ChatRecord) => ChatRecord | null,
): ChatRecords {
	const before = chats[chatId] ?? { activity: IDLE };
	const after = change(before);
	return after && after !== before ? { ...chats, [chatId]: after } : chats;
}

const withActivity = (
	chats: ChatRecords,
	chatId: string,
	change: (activity: ChatActivity) => ChatActivity | null,
) =>
	withRecord(chats, chatId, (record) => {
		const activity = change(record.activity);
		return activity ? { ...record, activity } : null;
	});

type PendingKey = "pendingPermissionIds" | "pendingQuestionIds";

const addPending = (key: PendingKey, id: string | undefined) => (activity: ChatActivity) =>
	id && !activity[key].includes(id) ? { ...activity, [key]: [...activity[key], id] } : null;

const removePending = (key: PendingKey, id: string | undefined) => (activity: ChatActivity) =>
	id && activity[key].includes(id)
		? { ...activity, [key]: activity[key].filter((pending) => pending !== id) }
		: null;

function withoutError(activity: ChatActivity): ChatActivity {
	const { lastError: _lastError, ...rest } = activity;
	return rest;
}

function applyStatus(chats: ChatRecords, chatId: string, status: ChatStatus, now: number) {
	if (status === "idle" && !chats[chatId]) return chats;
	return withActivity(chats, chatId, (activity) => {
		const wasWorking = isWorking(activity.status);
		if (status !== "idle") {
			// workingSince survives busy <-> retry flips; only the idle -> working edge stamps it.
			if (wasWorking) {
				return activity.status === status ? null : { ...activity, status };
			}
			return { ...withoutError(activity), status, workingSince: now, completedAt: undefined };
		}
		if (!wasWorking) return activity.status === "idle" ? null : { ...activity, status: "idle" };
		return { ...activity, status: "idle", workingSince: undefined, completedAt: now };
	});
}

/**
 * The session an event changes the fields of (its title, metadata, archive
 * state, location, rules), or a new one (created, forked): v2 sends these as
 * small events, so the session is read again.
 */
export function sessionChangedBy(event: OpenCodeEvent): string | undefined {
	switch (event.type) {
		case "session.created":
		case "session.forked":
		case "session.renamed":
		case "session.metadata.updated":
		case "session.archived":
		case "session.unarchived":
		case "session.moved":
		case "session.permissions":
			return event.data.sessionID;
		default:
			return undefined;
	}
}

/** The chat an event is about, if any. */
export function chatOf(event: OpenCodeEvent): string | undefined {
	if (event.type === "form.created") return asString(event.data.form.sessionID);
	const data = event.data as { readonly sessionID?: unknown };
	return asString(data.sessionID);
}

/** One server event applied; the same object back when it changes nothing. */
export function applyChatEvent(chats: ChatRecords, event: OpenCodeEvent, now: number): ChatRecords {
	const chatId = chatOf(event);
	if (!chatId) return chats;
	const next = applyToActivity(chats, event, chatId, now);
	return rememberDirectory(next, chatId, event.location?.directory);
}

/** A chat's info read from the server, and the directory the event that asked for it came from. */
export function applyChatInfo(
	chats: ChatRecords,
	info: ChatInfo,
	directory?: string | undefined,
): ChatRecords {
	const next = withRecord(chats, info.id, (record) =>
		sameInfo(record.info, info) ? null : { ...record, info },
	);
	return rememberDirectory(next, info.id, directory);
}

export function removeChat(chats: ChatRecords, chatId: string): ChatRecords {
	if (!(chatId in chats)) return chats;
	const { [chatId]: _deleted, ...rest } = chats;
	return rest;
}

function rememberDirectory(chats: ChatRecords, chatId: string, directory: string | undefined) {
	if (!directory || !chats[chatId]) return chats;
	return withRecord(chats, chatId, (record) =>
		record.directory === directory ? null : { ...record, directory },
	);
}

function applyToActivity(
	chats: ChatRecords,
	event: OpenCodeEvent,
	chatId: string,
	now: number,
): ChatRecords {
	switch (event.type) {
		case "permission.asked":
			return withActivity(chats, chatId, addPending("pendingPermissionIds", event.data.id));
		case "permission.replied":
			return withActivity(
				chats,
				chatId,
				removePending("pendingPermissionIds", event.data.requestID),
			);
		case "form.created":
			return withActivity(chats, chatId, addPending("pendingQuestionIds", event.data.form.id));
		case "form.replied":
		case "form.cancelled":
			return withActivity(chats, chatId, removePending("pendingQuestionIds", event.data.id));
		case "session.execution.started":
			return applyStatus(chats, chatId, "busy", now);
		case "session.retry.scheduled":
			return applyStatus(chats, chatId, "retry", now);
		case "session.status": {
			const status = asStatus(event.data.status.type);
			return status ? applyStatus(chats, chatId, status, now) : chats;
		}
		case "session.idle":
		case "session.execution.succeeded":
		case "session.execution.interrupted":
			return applyStatus(chats, chatId, "idle", now);
		case "session.execution.failed": {
			const { type, message } = event.data.error;
			const lastError: ChatError = { name: type, message: message || type };
			const failed = withActivity(chats, chatId, (activity) => ({ ...activity, lastError }));
			return applyStatus(failed, chatId, "idle", now);
		}
		case "session.deleted":
			return removeChat(chats, chatId);
		default:
			return chats;
	}
}

/**
 * A status read on (re)connect, without stamping `completedAt` (the finish
 * wasn't observed). Null when it changes nothing.
 */
export function applyHydratedStatus(
	activity: ChatActivity | undefined,
	statusType: string,
	now: number,
	options: { readonly skipBusyIfCompleted?: boolean } = {},
): ChatActivity | null {
	const status = asStatus(statusType);
	if (!status) return null;
	const wasWorking = isWorking(activity?.status);
	if (status === "idle") {
		if (!activity || !wasWorking) return null;
		return { ...activity, status: "idle", workingSince: undefined };
	}
	// A live completion that raced this read keeps the observed idle state.
	if (options.skipBusyIfCompleted && activity?.completedAt !== undefined && !wasWorking) {
		return null;
	}
	if (activity && activity.status === status && wasWorking) return null;
	const base = activity ?? IDLE;
	return {
		...base,
		status,
		workingSince: wasWorking ? base.workingSince : now,
		completedAt: undefined,
	};
}

/** The server process went away: its turns ended and its prompts with them. */
export function resetActivity(chats: ChatRecords): ChatRecords {
	let next: Record<string, ChatRecord> | undefined;
	for (const [id, record] of Object.entries(chats)) {
		const { activity } = record;
		if (!isWorking(activity.status) && !needsAttention(activity)) continue;
		next ??= { ...chats };
		next[id] = {
			...record,
			activity: cleanActivity({
				...activity,
				status: "idle",
				workingSince: undefined,
				pendingPermissionIds: [],
				pendingQuestionIds: [],
			}),
		};
	}
	return next ?? chats;
}

function cleanActivity(activity: ChatActivity): ChatActivity {
	return Object.fromEntries(
		Object.entries(activity).filter(([, value]) => value !== undefined),
	) as ChatActivity;
}

/** The chat, its parent, … up to its root (or the first unknown or repeated ancestor). */
export function lineageOf(chats: ChatRecords, chatId: string): string[] {
	const lineage = [chatId];
	for (
		let parentId = chats[chatId]?.info?.parentId;
		parentId && !lineage.includes(parentId);
		parentId = chats[parentId]?.info?.parentId
	) {
		lineage.push(parentId);
	}
	return lineage;
}

/**
 * For each chat working or waiting on the user, the topmost ancestor whose
 * info is unknown: the next one to look up to learn whether it is this app's.
 */
export function chatsAwaitingLineage(chats: ChatRecords): string[] {
	const pending = new Set<string>();
	for (const [id, record] of Object.entries(chats)) {
		if (!isWorking(record.activity.status) && !needsAttention(record.activity)) continue;
		const top = lineageOf(chats, id).at(-1)!;
		if (!chats[top]?.info) pending.add(top);
	}
	return [...pending];
}

/** The root's info when the chat's lineage ends in one of this app's chats. */
function ownedRoot(chats: ChatRecords, chatId: string): ChatInfo | undefined {
	const lineage = lineageOf(chats, chatId);
	const root = chats[lineage.at(-1)!]?.info;
	return root && root.parentId === null && hasKiloDesktopSessionMetadata(root.metadata)
		? root
		: undefined;
}

const summaries = new WeakMap<ChatRecord, { root: ChatInfo; summary: ChatSummary }>();

function summarize(record: ChatRecord, info: ChatInfo, root: ChatInfo): ChatSummary {
	const cached = summaries.get(record);
	if (cached?.root === root) return cached.summary;
	const folders = readWorkspaceFoldersFromMetadata(info.metadata);
	// In the schema's key order: the kernel stores state parsed, and diffs compare JSON.
	const summary: ChatSummary = {
		id: info.id,
		title: info.title,
		directory: info.directory,
		parentId: info.parentId,
		workSessionId:
			readWorkSessionIdFromMetadata(info.metadata) ??
			readWorkSessionIdFromMetadata(root.metadata) ??
			null,
		workspaceId:
			readWorkspaceIdFromMetadata(info.metadata) ??
			readWorkspaceIdFromMetadata(root.metadata) ??
			null,
		worktreeBranch:
			readWorktreeBranchFromMetadata(info.metadata) ??
			readWorktreeBranchFromMetadata(root.metadata) ??
			null,
		workspaceFolders:
			folders.length > 0 ? folders : readWorkspaceFoldersFromMetadata(root.metadata),
		createdAt: info.createdAt,
		updatedAt: info.updatedAt,
		...(info.archivedAt !== undefined ? { archivedAt: info.archivedAt } : {}),
		activity: cleanActivity(record.activity),
	};
	summaries.set(record, { root, summary });
	return summary;
}

/** This app's chats and their subagents, as other plugins see them. */
export function publishChats(chats: ChatRecords): Record<string, ChatSummary> {
	const published: Record<string, ChatSummary> = {};
	for (const [id, record] of Object.entries(chats)) {
		if (!record.info) continue;
		const root = ownedRoot(chats, id);
		if (root) published[id] = summarize(record, record.info, root);
	}
	return published;
}

type ConversationEventName = DomainObjectEventName<typeof Chats>;
export type ConversationEvent = {
	[TName in ConversationEventName]: {
		readonly name: TName;
		readonly payload: DomainObjectEventPayload<typeof Chats, TName>;
	};
}[ConversationEventName];

/**
 * The domain events between two published lists. Removals are not events
 * (only a server deletion is); turns and prompts only when `activity`.
 */
export function diffChats(
	before: Readonly<Record<string, ChatSummary>>,
	after: Readonly<Record<string, ChatSummary>>,
	options: { readonly activity: boolean },
): ConversationEvent[] {
	const events: ConversationEvent[] = [];
	for (const [id, chat] of Object.entries(after)) {
		const previous = before[id];
		if (!previous) events.push({ name: "created", payload: { chat } });
		else if (previous !== chat && JSON.stringify(previous) !== JSON.stringify(chat)) {
			events.push({ name: "updated", payload: { before: previous, after: chat } });
		} else continue;
		if (options.activity)
			events.push(...activityEvents(id, previous?.activity ?? IDLE, chat.activity));
	}
	return events;
}

function activityEvents(chatId: string, before: ChatActivity, after: ChatActivity) {
	const events: ConversationEvent[] = [];
	if (!isWorking(before.status) && isWorking(after.status)) {
		events.push({ name: "turn-started", payload: { chatId } });
	}
	if (isWorking(before.status) && !isWorking(after.status)) {
		events.push({
			name: "turn-ended",
			payload: { chatId, ...(after.lastError ? { error: after.lastError } : {}) },
		});
	}
	// Pending id lists hold a few entries; a Set would cost more.
	// react-doctor-disable-next-line react-doctor/js-set-map-lookups
	const added = (key: PendingKey) => after[key].filter((id) => !before[key].includes(id));
	// Pending id lists hold a few entries; a Set would cost more.
	// react-doctor-disable-next-line react-doctor/js-set-map-lookups
	const removed = (key: PendingKey) => before[key].filter((id) => !after[key].includes(id));
	for (const permissionId of added("pendingPermissionIds")) {
		events.push({ name: "permission-requested", payload: { chatId, permissionId } });
	}
	for (const permissionId of removed("pendingPermissionIds")) {
		events.push({ name: "permission-resolved", payload: { chatId, permissionId } });
	}
	for (const questionId of added("pendingQuestionIds")) {
		events.push({ name: "question-requested", payload: { chatId, questionId } });
	}
	for (const questionId of removed("pendingQuestionIds")) {
		events.push({ name: "question-resolved", payload: { chatId, questionId } });
	}
	return events;
}
