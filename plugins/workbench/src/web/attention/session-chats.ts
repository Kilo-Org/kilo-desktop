import type { ChatSummary } from "@kilo-desktop/plugin-agent/contracts";
import type { WorkSession } from "@kilo-desktop/plugin-sessions/contracts";

import { activityOfSession, type SessionActivity } from "../list/session-activity";

/*
 * A Work Session's live activity, combined from its Kilo chats (kilo.agent's
 * conversations) the way origin combined a chat with its subagents: their
 * prompts bubble up, the session works while any chat works.
 */

export type Chats = Readonly<Record<string, ChatSummary>>;

type SessionChats = Pick<WorkSession, "id" | "chatIds">;

/** Bounds the parent walk, as origin's prompt ancestry did; also stops a parent cycle. */
const MAX_PARENT_HOPS = 8;

/** The chat a chat descends from: its topmost known ancestor's parent link. */
export function rootChatOf(chats: Chats, chatId: string): string {
	let current = chatId;
	for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
		const parentId = chats[current]?.parentId;
		if (!parentId) break;
		current = parentId;
	}
	return current;
}

function childrenByParent(chats: Chats): Map<string, ChatSummary[]> {
	const children = new Map<string, ChatSummary[]>();
	for (const summary of Object.values(chats)) {
		if (!summary.parentId) continue;
		const siblings = children.get(summary.parentId);
		if (siblings) siblings.push(summary);
		else children.set(summary.parentId, [summary]);
	}
	return children;
}

function rootIdsOf(session: SessionChats, chats: Chats): string[] {
	const ids = new Set(session.chatIds);
	for (const summary of Object.values(chats)) {
		if (summary.parentId === null && summary.workSessionId === session.id) ids.add(summary.id);
	}
	return [...ids];
}

/** Each session's chats, then their subagents at any depth. */
export function chatsOfSessions(
	sessions: readonly SessionChats[],
	chats: Chats,
): Map<string, ChatSummary[]> {
	const children = childrenByParent(chats);
	const result = new Map<string, ChatSummary[]>();
	for (const session of sessions) {
		const seen = new Set<string>();
		const ordered: ChatSummary[] = [];
		const queue = rootIdsOf(session, chats);
		while (queue.length > 0) {
			const id = queue.shift()!;
			const summary = chats[id];
			if (!summary || seen.has(id)) continue;
			seen.add(id);
			ordered.push(summary);
			queue.push(...(children.get(id) ?? []).map((child) => child.id));
		}
		result.set(session.id, ordered);
	}
	return result;
}

/** The session holding a chat (through its root), or null when none does. */
export function sessionOfChat(
	sessions: readonly SessionChats[],
	chats: Chats,
	chatId: string,
): string | null {
	const rootId = rootChatOf(chats, chatId);
	const holder = sessions.find((session) => session.chatIds.includes(rootId));
	if (holder) return holder.id;
	const stamped = chats[rootId]?.workSessionId;
	return stamped && sessions.some((session) => session.id === stamped) ? stamped : null;
}

const isWorking = (summary: ChatSummary) =>
	summary.activity.status === "busy" || summary.activity.status === "retry";

function unionOf(lists: readonly (readonly string[])[]): string[] {
	return [...new Set(lists.flat())];
}

function latestRootError(chats: readonly ChatSummary[]): SessionActivity["lastError"] {
	let latest: ChatSummary | undefined;
	for (const summary of chats) {
		if (summary.parentId !== null || !summary.activity.lastError) continue;
		if ((summary.activity.completedAt ?? 0) >= (latest?.activity.completedAt ?? 0))
			latest = summary;
	}
	return latest?.activity.lastError;
}

function combine(session: WorkSession, chats: readonly ChatSummary[]): SessionActivity {
	const base = activityOfSession(session);
	if (chats.length === 0) return base;
	const working = chats.filter(isWorking);
	const status = working.some((summary) => summary.activity.status === "busy")
		? "busy"
		: working.length > 0
			? "retry"
			: "idle";
	const starts = working.flatMap((summary) => summary.activity.workingSince ?? []);
	const completions = chats.flatMap((summary) => summary.activity.completedAt ?? []);
	const lastError = latestRootError(chats);
	return {
		...base,
		status,
		...(starts.length > 0 ? { workingSince: Math.min(...starts) } : {}),
		...(completions.length > 0 ? { completedAt: Math.max(...completions) } : {}),
		...(lastError ? { lastError } : {}),
		pendingPermissionIds: unionOf(chats.map((summary) => summary.activity.pendingPermissionIds)),
		pendingQuestionIds: unionOf(chats.map((summary) => summary.activity.pendingQuestionIds)),
	};
}

/** Every session's activity, combined from its chats and their subagents. */
export function sessionActivities(
	sessions: readonly WorkSession[],
	chats: Chats,
): Record<string, SessionActivity> {
	const chatsBySession = chatsOfSessions(sessions, chats);
	const activities: Record<string, SessionActivity> = {};
	for (const session of sessions) {
		activities[session.id] = combine(session, chatsBySession.get(session.id) ?? []);
	}
	return activities;
}
