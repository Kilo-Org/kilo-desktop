import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import { isActive, type MemberState, type TeamMember } from "./swarm-team";

/** A quiet stretch at least this long starts a new run. */
export const RUN_GAP_MS = 2 * 60_000;

/** One agent's lane in a run: where its work starts and ends, as fractions of the run. */
export interface TimelineLane {
	readonly chatId: string;
	readonly title: string;
	readonly state: MemberState;
	readonly start: number;
	readonly end: number;
	/**
	 * `known`: it finished at `end`; `running`: it runs until now; `unknown`:
	 * nothing says when it stopped, so the bar reaches its last known moment
	 * (its newest post, else its start) drawn as uncertain.
	 */
	readonly ending: "known" | "running" | "unknown";
	/** Its posts in the run, as fractions of the run. */
	readonly posts: readonly { readonly id: string; readonly at: number; readonly type: string }[];
}

/** One burst of the team's work on its own time axis. */
export interface Timeline {
	readonly from: number;
	readonly to: number;
	readonly lanes: readonly TimelineLane[];
	/** How many posts fall in it. */
	readonly postCount: number;
	/** Someone is still working in it (the last run only). */
	readonly live: boolean;
}

interface Span {
	from: number;
	to: number;
}

/**
 * The team's work split into runs — bursts separated by at least
 * `RUN_GAP_MS` of quiet, such as two prompts minutes apart — each on its own
 * time axis with only the agents that worked in it, so a long pause doesn't
 * squeeze both into slivers. A worker's run (start to finish, or to now, or
 * to its last known moment) and every post count as activity; the main agent
 * spans the whole chat, so only its posts and the end of its last turn do. The main agent has a lane in
 * every run (it is who workers answer to); members nothing dates are left out.
 */
export function teamRuns(
	team: readonly TeamMember[],
	messages: readonly BoardMessage[],
	now: number,
	mainChatId: string,
): Timeline[] {
	const sender = (message: BoardMessage) => (message.from === "main" ? mainChatId : message.from);
	const postsBy = new Map<string, BoardMessage[]>();
	for (const message of messages) {
		const id = sender(message);
		postsBy.set(id, [...(postsBy.get(id) ?? []), message]);
	}
	const dated = team.filter((member) => member.startedAt !== undefined);
	const lastKnown = (member: TeamMember) =>
		Math.max(
			member.startedAt!,
			...(postsBy.get(member.chatId) ?? []).map((post) => post.timestamp),
		);
	const workEnd = (member: TeamMember) =>
		isActive(member.state) ? now : (member.completedAt ?? lastKnown(member));
	const workers = dated.filter((member) => !member.main);
	const main = dated.find((member) => member.main);

	const activity: Span[] = [
		...workers.map((member) => ({ from: member.startedAt!, to: workEnd(member) })),
		...messages.map((message) => ({ from: message.timestamp, to: message.timestamp })),
		...(main ? [{ from: main.startedAt!, to: main.startedAt! }] : []),
		...(main?.completedAt !== undefined ? [{ from: main.completedAt, to: main.completedAt }] : []),
		...(main && isActive(main.state) ? [{ from: now, to: now }] : []),
	].toSorted((a, b) => a.from - b.from);
	const runs: Span[] = [];
	for (const span of activity) {
		const last = runs.at(-1);
		if (last && span.from - last.to < RUN_GAP_MS) last.to = Math.max(last.to, span.to);
		else runs.push({ ...span });
	}

	return runs.map((run, index) => {
		const span = Math.max(1, run.to - run.from);
		const at = (time: number) => Math.min(1, Math.max(0, (time - run.from) / span));
		const inRun = (time: number) => time >= run.from && time <= run.to;
		const postsIn = (chatId: string) =>
			(postsBy.get(chatId) ?? [])
				.filter((post) => inRun(post.timestamp))
				.map((post) => ({ id: post.id, at: at(post.timestamp), type: post.type }));
		const lanes: TimelineLane[] = [];
		if (main) {
			const mainPosts = (postsBy.get(main.chatId) ?? []).filter((post) => inRun(post.timestamp));
			const running = isActive(main.state) && index === runs.length - 1;
			const start = Math.max(main.startedAt!, run.from);
			const finished =
				main.completedAt !== undefined && inRun(main.completedAt) ? [main.completedAt] : [];
			const end = running
				? run.to
				: Math.max(start, ...finished, ...mainPosts.map((post) => post.timestamp));
			lanes.push({
				chatId: main.chatId,
				title: "Main agent",
				state: main.state,
				start: at(start),
				end: at(end),
				ending: running ? "running" : "known",
				posts: postsIn(main.chatId),
			});
		}
		for (const member of workers) {
			const end = workEnd(member);
			if (member.startedAt! > run.to || end < run.from) continue;
			lanes.push({
				chatId: member.chatId,
				title: member.title,
				state: member.state,
				start: at(member.startedAt!),
				end: at(end),
				ending: isActive(member.state)
					? "running"
					: member.completedAt !== undefined
						? "known"
						: "unknown",
				posts: postsIn(member.chatId),
			});
		}
		return {
			from: run.from,
			to: run.to,
			lanes,
			postCount: messages.filter((message) => inRun(message.timestamp)).length,
			live: index === runs.length - 1 && dated.some((member) => isActive(member.state)),
		};
	});
}
