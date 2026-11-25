import type { DomainObjectEventName, DomainObjectEventPayload } from "@kilo-desktop/kernel";

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

/** A Kilo session as the server reports it (`SessionInfo`: list rows and lookups). */
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

/** One event from the server's stream (a v2 frame: `type`, `data`, its time and location). */
export interface KiloEvent {
	readonly type: string;
	readonly data: Readonly<Record<string, unknown>>;
	/** When the server published it (ms); absent on `server.connected`. */
	readonly created?: number | undefined;
	/** The location (directory) it happened in. */
	readonly directory?: string | undefined;
}

export const IDLE: ChatActivity = {
	status: "idle",
	pendingPermissionIds: [],
	pendingQuestionIds: [],
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asStatus = (value: unknown): ChatStatus | undefined =>
	value === "busy" || value === "retry" || value === "idle" ? value : undefined;

const isWorking = (status: ChatStatus | undefined) => status === "busy" || status === "retry";

export function needsAttention(activity: ChatActivity): boolean {
	return activity.pendingPermissionIds.length > 0 || activity.pendingQuestionIds.length > 0;
}

/** Reads a Kilo session (`SessionInfo`); undefined when it isn't one. */
export function readChatInfo(value: unknown): ChatInfo | undefined {
	const raw = asRecord(value);
	const id = asString(raw?.id);
	const time = asRecord(raw?.time);
	const createdAt = asNumber(time?.created);
	if (!raw || !id || createdAt === undefined) return undefined;
	const archivedAt = asNumber(time?.archived);
	return {
		id,
		title: typeof raw.title === "string" ? raw.title : "",
		parentId: asString(raw.parentID) ?? null,
		directory: asString(asRecord(raw.location)?.directory) ?? null,
		metadata: raw.metadata ?? null,
		createdAt,
		updatedAt: asNumber(time?.updated) ?? createdAt,
		...(archivedAt !== undefined ? { archivedAt } : {}),
	};
}

/** The chat a `session.created` event announces; it carries no times, so the event's own stamps both. */
function readCreatedChat(event: KiloEvent): ChatInfo | undefined {
	const data = event.data;
	const id = asString(data.sessionID);
	if (!id || event.created === undefined) return undefined;
	return {
		id,
		title: typeof data.title === "string" ? data.title : "",
		parentId: asString(data.parentID) ?? null,
		directory: asString(asRecord(data.location)?.directory) ?? null,
		metadata: data.metadata ?? null,
		createdAt: event.created,
		updatedAt: event.created,
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

/** A turn's failure (`SessionStructuredError`: `type`, `message`). */
function readError(value: unknown): ChatError | undefined {
	const error = asRecord(value);
	const name = asString(error?.type);
	if (!name) return undefined;
	return { name, message: asString(error?.message) ?? name };
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

/** The chat a server event is about, if any. */
export function chatIdOfEvent(event: KiloEvent): string | undefined {
	return asString(event.data.sessionID) ?? asString(asRecord(event.data.form)?.sessionID);
}

/** One server event applied; the same object back when it changes nothing. */
export function applyKiloEvent(chats: ChatRecords, event: KiloEvent, now: number): ChatRecords {
	const chatId = chatIdOfEvent(event);
	if (!chatId) return chats;
	const next = applyToChat(chats, event, chatId, now);
	if (!event.directory || !next[chatId] || event.type === "session.moved") return next;
	const directory = event.directory;
	return withRecord(next, chatId, (record) =>
		record.directory === directory ? null : { ...record, directory },
	);
}

/** Changes the chat's known info, if it is known; info arrives with lists and lookups. */
function withInfo(
	chats: ChatRecords,
	chatId: string,
	event: KiloEvent,
	change: (info: ChatInfo) => ChatInfo,
): ChatRecords {
	return withRecord(chats, chatId, (record) => {
		if (!record.info) return null;
		const changed = change(record.info);
		const info =
			event.created !== undefined && event.created > changed.updatedAt
				? { ...changed, updatedAt: event.created }
				: changed;
		return sameInfo(record.info, info) ? null : { ...record, info };
	});
}

function applyToChat(
	chats: ChatRecords,
	event: KiloEvent,
	chatId: string,
	now: number,
): ChatRecords {
	const data = event.data;
	switch (event.type) {
		case "permission.asked":
			return withActivity(chats, chatId, addPending("pendingPermissionIds", asString(data.id)));
		case "permission.replied":
			return withActivity(
				chats,
				chatId,
				removePending("pendingPermissionIds", asString(data.requestID)),
			);
		case "form.created": {
			const form = asRecord(data.form);
			if (asRecord(form?.metadata)?.kind !== "question") return chats;
			return withActivity(chats, chatId, addPending("pendingQuestionIds", asString(form?.id)));
		}
		case "form.replied":
		case "form.cancelled":
			return withActivity(chats, chatId, removePending("pendingQuestionIds", asString(data.id)));
		case "session.execution.started":
			return applyStatus(chats, chatId, "busy", now);
		case "session.retry.scheduled":
			return applyStatus(chats, chatId, "retry", now);
		case "session.step.started":
			// The step a retry waited for: working again, still the same turn.
			return chats[chatId]?.activity.status === "retry"
				? applyStatus(chats, chatId, "busy", now)
				: chats;
		case "session.execution.succeeded":
		case "session.execution.interrupted":
			return applyStatus(chats, chatId, "idle", now);
		case "session.execution.failed": {
			const error = readError(data.error);
			const settled = applyStatus(chats, chatId, "idle", now);
			return error
				? withActivity(settled, chatId, (activity) => ({ ...activity, lastError: error }))
				: settled;
		}
		case "session.created": {
			const info = readCreatedChat(event);
			if (!info) return chats;
			return withRecord(chats, chatId, (record) => (record.info ? null : { ...record, info }));
		}
		case "session.renamed":
			return typeof data.title === "string"
				? withInfo(chats, chatId, event, (info) => ({ ...info, title: data.title as string }))
				: chats;
		case "session.metadata.updated":
			return withInfo(chats, chatId, event, (info) => ({
				...info,
				metadata: data.metadata ?? null,
			}));
		case "session.archived":
			return withInfo(chats, chatId, event, (info) => ({
				...info,
				archivedAt: event.created ?? now,
			}));
		case "session.unarchived":
			return withInfo(chats, chatId, event, ({ archivedAt: _archivedAt, ...info }) => info);
		case "session.moved": {
			const directory = asString(asRecord(data.location)?.directory);
			if (!directory) return chats;
			const moved = withInfo(chats, chatId, event, (info) => ({ ...info, directory }));
			return withRecord(moved, chatId, (record) =>
				record.directory === directory ? null : { ...record, directory },
			);
		}
		case "session.deleted": {
			if (!(chatId in chats)) return chats;
			const { [chatId]: _deleted, ...rest } = chats;
			return rest;
		}
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
	const added = (key: PendingKey) => {
		const had = new Set(before[key]);
		return after[key].filter((id) => !had.has(id));
	};
	const removed = (key: PendingKey) => {
		const has = new Set(after[key]);
		return before[key].filter((id) => !has.has(id));
	};
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
