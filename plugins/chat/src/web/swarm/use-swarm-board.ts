import { useEffect, useEffectEvent, useRef, useState } from "react";

import { KernelError, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import {
	Chats,
	Swarm,
	SWARM_BOARD_PAGE_LIMIT,
	type BackgroundJob,
	type ChatSummary,
	type SwarmTeam,
} from "@kilo-desktop/plugin-core/contracts";

import { teamColors } from "./swarm-colors";

import { EMPTY_FEED, mergeNewest, mergeOlder, type BoardFeed } from "./board-feed";
import { rosterTeam, swarmTeam, teamIsWorking, type TeamMember } from "./swarm-team";

/** How often the board is read while the team works, on Kilo CLIs that announce no board changes. */
export const SWARM_POLL_MS = 4_000;

const NO_CHATS: Readonly<Record<string, ChatSummary>> = {};
const NO_JOBS: readonly BackgroundJob[] = [];

const messageOf = (error: unknown) =>
	error instanceof Error && error.message ? error.message : "Something went wrong.";

export type ResetOutcome = "cleared" | "changed" | "failed";

export interface SwarmBoardView {
	/** True until the first read answers. */
	readonly loading: boolean;
	/** Failed read sources; each retains its last good data independently. */
	readonly error: string | null;
	readonly feed: BoardFeed;
	readonly team: readonly TeamMember[];
	/** Each member's color (by chat id, and `main`), shared with its pane. */
	readonly colors: ReadonlyMap<string, string>;
	readonly jobs: readonly BackgroundJob[];
	readonly loadingOlder: boolean;
	/** Resolves after the older read settles; stale reads never change the feed. */
	loadOlder(): Promise<void>;
	refresh(): void;
	/** Clears the board at the revision shown; "changed" when it moved meanwhile (it is read again). */
	reset(revision: number): Promise<ResetOutcome>;
	cancelJob(jobId: string): Promise<void>;
}

/**
 * One root chat's reads in flight. A new chat gets a new scope, so a read
 * started for the previous chat finds its scope replaced and drops its answer.
 */
interface ReadScope {
	readonly chatId: string;
	/** Bumped by each newest-page read; only the latest one lands. */
	generation: number;
	/** Bumped by resets; an older-page read from before one never lands. */
	olderGeneration: number;
	/** The newest revision a reset cleared, here or announced by Kilo. */
	clearedRevision: number;
	pendingOlder: Promise<void> | null;
}

const newScope = (chatId: string): ReadScope => ({
	chatId,
	generation: 0,
	olderGeneration: 0,
	clearedRevision: 0,
	pendingOlder: null,
});

/**
 * A root chat's Kilo Swarm, read through kilo.core: the board (newest page,
 * then older pages on demand), its background jobs, and the team — Kilo's
 * roster when the server has one, else derived from kilo.core's chats. The board is read again when Kilo announces a
 * change, when a chat of the team changes and, on Kilo CLIs that announce
 * nothing, every `SWARM_POLL_MS` while anyone works. Each source keeps its
 * last good value on partial failure. Newest reads supersede earlier refreshes;
 * reset and chat changes invalidate older-page reads independently, so polling
 * cannot starve pagination and a late response cannot resurrect cleared posts.
 */
export function useSwarmBoard(rootChatId: string): SwarmBoardView {
	const swarm = useDomainObject(Swarm);
	const boardEvents =
		useDomainObjectState(Swarm, (state: DomainObjectState<typeof Swarm>) => state.boardEvents) ??
		false;
	const chats =
		useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) => state.chats) ??
		NO_CHATS;
	const [shownChatId, setShownChatId] = useState(rootChatId);
	const [feed, setFeed] = useState<BoardFeed>(EMPTY_FEED);
	const [jobs, setJobs] = useState<readonly BackgroundJob[]>(NO_JOBS);
	const [roster, setRoster] = useState<SwarmTeam | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [error, setError] = useState<string | null>(null);
	if (shownChatId !== rootChatId) {
		setShownChatId(rootChatId);
		setFeed(EMPTY_FEED);
		setRoster(null);
		setJobs(NO_JOBS);
		setError(null);
		setLoadingOlder(false);
		setLoading(true);
	}
	const feedRef = useLatestRef(feed);
	const reads = useRef<ReadScope | null>(null);
	/** The current chat's scope, replacing the previous chat's. Call outside render only. */
	const scopeFor = (chatId: string): ReadScope => {
		if (reads.current?.chatId !== chatId) reads.current = newScope(chatId);
		return reads.current;
	};
	const isCurrent = (scope: ReadScope) => reads.current === scope;

	const derived = swarmTeam(rootChatId, chats, jobs);
	const team = roster ? rosterTeam(rootChatId, chats, roster, jobs) : derived;
	const working = teamIsWorking(team, jobs);
	const colors = teamColors(rootChatId, chats, roster?.members ?? []);
	/**
	 * Changes whenever a member's activity does (from kilo.core's chats, which
	 * the reads below don't change): the board and roster likely moved.
	 */
	const teamSignature = derived.map((member) => `${member.chatId}:${member.state}`).join("|");

	const refresh = () => {
		if (!swarm) return;
		const scope = scopeFor(rootChatId);
		const run = ++scope.generation;
		const landed = () => isCurrent(scope) && run === scope.generation;
		void Promise.allSettled([
			swarm.methods.board({ chatId: rootChatId, limit: SWARM_BOARD_PAGE_LIMIT }),
			swarm.methods.jobs({ chatId: rootChatId }),
			swarm.methods.team({ chatId: rootChatId }),
		])
			.then(([board, nextJobs, nextRoster]) => {
				if (!landed()) return;
				const failures: string[] = [];
				if (board.status === "fulfilled") {
					setFeed((current) => (landed() ? mergeNewest(current, board.value) : current));
				} else failures.push(`Board: ${messageOf(board.reason)}`);
				if (nextJobs.status === "fulfilled") setJobs(nextJobs.value);
				else failures.push(`Background jobs: ${messageOf(nextJobs.reason)}`);
				if (nextRoster.status === "fulfilled") setRoster(nextRoster.value);
				else failures.push(`Team roster: ${messageOf(nextRoster.reason)}`);
				setError(
					failures.length
						? `${failures.join(" ")} Some information may be missing or out of date.`
						: null,
				);
			})
			.finally(() => {
				if (landed()) setLoading(false);
			});
	};

	/** Drops older-page reads begun before a reset. */
	const invalidateOlder = (scope: ReadScope) => {
		scope.olderGeneration += 1;
		scope.pendingOlder = null;
		setLoadingOlder(false);
	};

	// Read again when the chat changes, the domain object arrives, or a member's activity moves.
	const readAgain = useEffectEvent((_swarm: unknown, _chat: string, _signature: string) =>
		refresh(),
	);
	useEffect(() => readAgain(swarm, rootChatId, teamSignature), [rootChatId, swarm, teamSignature]);

	useEffect(() => {
		if (!swarm) return;
		return swarm.on("board-updated", ({ chatId, cleared }) => {
			const owner = feedRef.current.ownerChatId;
			if (chatId !== rootChatId && chatId !== owner) return;
			const scope = scopeFor(rootChatId);
			if (cleared > scope.clearedRevision) {
				scope.clearedRevision = cleared;
				invalidateOlder(scope);
			}
			refresh();
		});
	}, [feedRef, invalidateOlder, refresh, rootChatId, scopeFor, swarm]);

	useEffect(() => {
		if (!working || boardEvents) return;
		const timer = setInterval(refresh, SWARM_POLL_MS);
		return () => clearInterval(timer);
	}, [boardEvents, refresh, working]);

	const loadOlder = () => {
		const scope = scopeFor(rootChatId);
		const cursor = feedRef.current.cursor;
		if (scope.pendingOlder) return scope.pendingOlder;
		if (!swarm || !cursor) return Promise.resolve();
		const run = scope.olderGeneration;
		const landed = () => isCurrent(scope) && run === scope.olderGeneration;
		setLoadingOlder(true);
		const pending = swarm.methods
			.board({ chatId: rootChatId, before: cursor, limit: SWARM_BOARD_PAGE_LIMIT })
			.then((board) => {
				if (!landed()) return;
				setFeed((current) =>
					landed() && current.cursor === cursor ? mergeOlder(current, board) : current,
				);
			})
			.catch((reason: unknown) => {
				if (landed()) setError(messageOf(reason));
			})
			.finally(() => {
				if (scope.pendingOlder !== pending) return;
				scope.pendingOlder = null;
				setLoadingOlder(false);
			});
		scope.pendingOlder = pending;
		return pending;
	};

	const reset = async (revision: number): Promise<ResetOutcome> => {
		if (!swarm) return "failed";
		const scope = scopeFor(rootChatId);
		scope.generation += 1;
		invalidateOlder(scope);
		try {
			const board = await swarm.methods.reset({ chatId: rootChatId, revision });
			if (!isCurrent(scope)) return "failed";
			scope.clearedRevision = Math.max(scope.clearedRevision, revision);
			scope.generation += 1;
			invalidateOlder(scope);
			setFeed(mergeNewest(EMPTY_FEED, board));
			return "cleared";
		} catch (reason) {
			if (!isCurrent(scope)) return "failed";
			if (reason instanceof KernelError && reason.code === "CONFLICT") {
				refresh();
				return "changed";
			}
			setError(messageOf(reason));
			return "failed";
		}
	};

	const cancelJob = async (jobId: string) => {
		if (!swarm) return;
		await swarm.methods.cancelJob({ chatId: rootChatId, jobId });
		refresh();
	};

	return {
		loading,
		error,
		feed,
		team,
		colors,
		jobs,
		loadingOlder,
		loadOlder,
		refresh,
		reset,
		cancelJob,
	};
}
