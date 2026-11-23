import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";

/** How a work session's subagents are doing. */
export interface SessionSwarmState {
	readonly subagents: number;
	readonly working: number;
	readonly needsYou: number;
}

const NONE: SessionSwarmState = { subagents: 0, working: 0, needsYou: 0 };

function delegatedFrom(
	chat: ChatSummary,
	roots: ReadonlySet<string>,
	chats: Readonly<Record<string, ChatSummary>>,
): boolean {
	for (let parent = chat.parentId, depth = 0; parent && depth < 16; depth += 1) {
		if (roots.has(parent)) return true;
		parent = chats[parent]?.parentId ?? null;
	}
	return false;
}

/** The subagents kilo.core lists below any of a work session's chats. */
export function sessionSwarmState(
	chatIds: readonly string[],
	chats: Readonly<Record<string, ChatSummary>>,
): SessionSwarmState {
	if (chatIds.length === 0) return NONE;
	const roots = new Set(chatIds);
	let subagents = 0;
	let working = 0;
	let needsYou = 0;
	for (const chat of Object.values(chats)) {
		if (!delegatedFrom(chat, roots, chats)) continue;
		subagents += 1;
		const { activity } = chat;
		if (activity.status !== "idle") working += 1;
		if (activity.pendingPermissionIds.length > 0 || activity.pendingQuestionIds.length > 0)
			needsYou += 1;
	}
	return { subagents, working, needsYou };
}

export function swarmLabel({ subagents, working, needsYou }: SessionSwarmState): string {
	if (needsYou > 0) return `Swarm: ${needsYou} ${needsYou === 1 ? "needs" : "need"} you`;
	if (working > 0) return `Swarm: ${working} working`;
	return `Swarm: ${subagents} finished`;
}
