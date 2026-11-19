import type { BoardMessage, BoardMessageType } from "@kilo-desktop/plugin-core/contracts";

import type { Timeline } from "./team-timeline";

/** One post as an arrow on the timeline: from its sender's lane to its recipient's. */
export interface SequenceArrow {
	readonly id: string;
	/** The sender's lane index. */
	readonly from: number;
	/** The recipient's lane index, `all` for everyone, or null for someone off the chart. */
	readonly to: number | "all" | null;
	/** Where on the time axis, as a fraction of the strip. */
	readonly at: number;
	readonly type: BoardMessageType;
	readonly timestamp: number;
	readonly replyTo?: string;
}

/** Kilo's board names for the root chat, everyone and the person. */
const MAIN = "main";
const EVERYONE = "ALL";

/**
 * The run's posts laid on its lanes (posts outside the run are left out):
 * the board names the root
 * chat `main`; posts from someone without a lane (the person, an agent no
 * longer listed) are left out, and posts to one get a dot without an arrow.
 */
export function sequenceArrows(
	timeline: Timeline,
	messages: readonly BoardMessage[],
	mainChatId: string,
): SequenceArrow[] {
	const lane = new Map(timeline.lanes.map((candidate, index) => [candidate.chatId, index]));
	const laneOf = (id: string) => lane.get(id === MAIN ? mainChatId : id);
	const span = Math.max(1, timeline.to - timeline.from);
	return messages.flatMap((message): SequenceArrow[] => {
		if (message.timestamp < timeline.from || message.timestamp > timeline.to) return [];
		const from = laneOf(message.from);
		if (from === undefined) return [];
		const to = message.to === EVERYONE ? "all" : (laneOf(message.to) ?? null);
		return [
			{
				id: message.id,
				from,
				to: to === from ? null : to,
				at: Math.min(1, Math.max(0, (message.timestamp - timeline.from) / span)),
				type: message.type,
				timestamp: message.timestamp,
				...(message.replyTo ? { replyTo: message.replyTo } : {}),
			},
		];
	});
}

/** Every post of the thread `id` belongs to (its root and all replies below it). */
export function threadIds(messages: readonly BoardMessage[], id: string): ReadonlySet<string> {
	const byId = new Map(messages.map((message) => [message.id, message]));
	let root = byId.get(id);
	for (let depth = 0; depth < 64 && root?.replyTo && byId.has(root.replyTo); depth += 1) {
		root = byId.get(root.replyTo);
	}
	if (!root) return new Set([id]);
	const ids = new Set([root.id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const message of messages) {
			if (message.replyTo && ids.has(message.replyTo) && !ids.has(message.id)) {
				ids.add(message.id);
				grew = true;
			}
		}
	}
	return ids;
}
