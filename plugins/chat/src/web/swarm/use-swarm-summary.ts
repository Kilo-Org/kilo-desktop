import { useEffect, useState } from "react";

import type { DomainObjectHandle, DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	Chats,
	Swarm,
	SWARM_BOARD_PAGE_LIMIT,
	type BackgroundJob,
	type ChatSummary,
} from "@kilo-desktop/plugin-core/contracts";

import { useSwarmBoardStore } from "./swarm-board-store";
import { teamColors } from "./swarm-colors";
import { summarizeSwarm, type BoardPage, type SwarmSummary } from "./swarm-summary";
import { isActive, swarmTeam } from "./swarm-team";

export type { SwarmSummary } from "./swarm-summary";

const NO_CHATS: Readonly<Record<string, ChatSummary>> = {};
const NO_JOBS: readonly BackgroundJob[] = [];

/** What was read, and for which root chat (an answer for the previous one is ignored). */
interface Reads {
	readonly chatId: string;
	readonly page: BoardPage | null;
	readonly jobs: readonly BackgroundJob[];
}

/**
 * A root chat's swarm at a glance (see {@link SwarmSummary}); null without a
 * root chat. The team comes from kilo.core's chats; the board's newest page
 * and the background jobs are read once, then again when Kilo announces a
 * board change or a team member starts, stops or joins — never on a timer.
 * Pass null to read nothing (a chat that never delegated).
 */
export function useSwarmSummary(rootChatId: string | null): SwarmSummary | null {
	const swarm = useDomainObject(Swarm);
	const chats =
		useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) => state.chats) ??
		NO_CHATS;
	const seenAt = useSwarmBoardStore((state) => (rootChatId ? state.seen[rootChatId] : undefined));
	const [reads, setReads] = useState<Reads | null>(null);
	const liveTeam = rootChatId ? swarmTeam(rootChatId, chats, NO_JOBS) : [];
	const trigger = `${liveTeam.length}:${liveTeam.filter((member) => isActive(member.state)).length}`;

	useEffect(() => watchSwarm(swarm, rootChatId, trigger, setReads), [rootChatId, swarm, trigger]);

	if (!rootChatId) return null;
	const current = reads?.chatId === rootChatId ? reads : null;
	const jobs = current?.jobs ?? NO_JOBS;
	return summarizeSwarm({
		team: swarmTeam(rootChatId, chats, jobs),
		colors: teamColors(rootChatId, chats),
		jobs,
		page: current?.page ?? null,
		seenAt,
	});
}

/** False only when Kilo's config turns the Swarm Board off; unknown counts as on. */
export function useSwarmEnabled(): boolean {
	return (
		useDomainObjectState(Swarm, (state: DomainObjectState<typeof Swarm>) => state.enabled) !== false
	);
}

/**
 * Reads the board's newest page and the root's background jobs now and the
 * page again whenever Kilo announces a change, until the returned cleanup
 * runs. `_trigger` is the team event that re-runs it.
 */
function watchSwarm(
	swarm: DomainObjectHandle<typeof Swarm> | null,
	rootChatId: string | null,
	_trigger: string,
	onRead: (update: (current: Reads | null) => Reads) => void,
): (() => void) | undefined {
	if (!swarm || !rootChatId) return;
	let live = true;
	const land = (patch: Partial<Omit<Reads, "chatId">>) => {
		if (!live) return;
		onRead((current) => ({
			chatId: rootChatId,
			page: current?.chatId === rootChatId ? current.page : null,
			jobs: current?.chatId === rootChatId ? current.jobs : NO_JOBS,
			...patch,
		}));
	};
	const readPage = () =>
		void swarm.methods
			.board({ chatId: rootChatId, limit: SWARM_BOARD_PAGE_LIMIT })
			.then(({ revision, messages }) => land({ page: { revision, messages } }))
			.catch(() => undefined);
	readPage();
	void swarm.methods
		.jobs({ chatId: rootChatId })
		.then((jobs) => land({ jobs }))
		.catch(() => undefined);
	const stop = swarm.on("board-updated", ({ chatId }) => {
		if (chatId === rootChatId) readPage();
	});
	return () => {
		live = false;
		stop();
	};
}
