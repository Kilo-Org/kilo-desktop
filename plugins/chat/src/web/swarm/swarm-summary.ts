import type { BackgroundJob, BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import { unreadCount } from "./board-insights";
import { isActive, teamIsWorking, type TeamMember } from "./swarm-team";

/** A root chat's swarm at a glance, for the composer's shelf, the transcript's card and the sidebar. */
export interface SwarmSummary {
	/** Posts since the board's last reset (Kilo numbers them without gaps). */
	readonly posts: number;
	readonly latest?: BoardMessage;
	/** Agents' posts newer than the newest the person has seen (up to a page's worth). */
	readonly newCount: number;
	/** The main agent first, then the workers. */
	readonly team: readonly TeamMember[];
	readonly colors: ReadonlyMap<string, string>;
	/** Workers working now. */
	readonly working: number;
	/** Workers that stopped, however they ended. */
	readonly done: number;
	/** Workers waiting on the person (the main agent asks in the composer itself). */
	readonly needsYou: readonly TeamMember[];
	/** Anyone works: the main agent, a worker or a background job. */
	readonly live: boolean;
	/** When the last worker stopped, once nobody works. */
	readonly finishedAt?: number;
}

/** The newest page of a board, as far as the summary needs it. */
export interface BoardPage {
	readonly revision: number;
	readonly messages: readonly BoardMessage[];
}

export function summarizeSwarm({
	team,
	colors,
	jobs,
	page,
	seenAt,
}: {
	readonly team: readonly TeamMember[];
	readonly colors: ReadonlyMap<string, string>;
	readonly jobs: readonly BackgroundJob[];
	readonly page: BoardPage | null;
	readonly seenAt: number | undefined;
}): SwarmSummary {
	const workers = team.filter((member) => !member.main);
	const working = workers.filter((member) => isActive(member.state)).length;
	const live = teamIsWorking(team, jobs);
	const stopped = workers.flatMap((member) =>
		member.completedAt === undefined ? [] : [member.completedAt],
	);
	const latest = page?.messages.at(-1);
	return {
		posts: page?.revision ?? 0,
		...(latest ? { latest } : {}),
		newCount: page ? unreadCount(page.messages, seenAt) : 0,
		team,
		colors,
		working,
		done: workers.length - working,
		needsYou: workers.filter((member) => member.needsYou),
		live,
		...(!live && stopped.length > 0 ? { finishedAt: Math.max(...stopped) } : {}),
	};
}

/** A post's first non-empty line, for one-line previews. */
export function firstLine(body: string): string {
	return (
		body
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean) ?? ""
	);
}

/** What a worker waits on the person for, in a few words. */
export function needsYouSummary(member: Pick<TeamMember, "attention">): string {
	const attention = member.attention ?? [];
	if (attention.includes("question") && attention.includes("permission"))
		return "has a question and needs permission";
	if (attention.includes("question")) return "has a question";
	if (attention.includes("permission")) return "needs permission";
	return "needs you";
}

/** "3 working · 1 done", leaving out zero counts (and "No agents yet" when both are). */
export function workCounts(working: number, done: number): string {
	const parts = [
		...(working > 0 ? [`${working} working`] : []),
		...(done > 0 ? [`${done} done`] : []),
	];
	return parts.length > 0 ? parts.join(" · ") : "No agents yet";
}
