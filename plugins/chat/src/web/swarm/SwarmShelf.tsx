import { ChevronRightIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";

import type { SubagentActivity } from "../subagents/SubagentActivityContext";
import { isActiveSubagentStatus } from "../subagents/subagent-state";
import { useOpenSubagentPane } from "../subagents/use-open-subagent-pane";
import { SwarmFaces } from "./SwarmFaces";
import { useSwarmBoardStore } from "./swarm-board-store";
import { firstLine, needsYouSummary, workCounts, type SwarmSummary } from "./swarm-summary";
import { isActive, participantName, type TeamMember } from "./swarm-team";
import type { OpenSwarmBoard } from "./use-open-swarm-board";

/**
 * The team as the transcript's delegations know it, for a swarm kilo.core
 * doesn't list yet: the main agent, then each delegated subagent.
 */
function teamFromActivities(
	rootChatId: string,
	main: TeamMember | undefined,
	activities: readonly SubagentActivity[],
): TeamMember[] {
	return [
		main ?? { chatId: rootChatId, title: "Main agent", main: true, state: "idle", needsYou: false },
		...activities.map((activity): TeamMember => ({
			chatId: activity.childSessionId,
			parentChatId: rootChatId,
			title: activity.title,
			main: false,
			state: isActiveSubagentStatus(activity.status) ? "working" : "done",
			needsYou: activity.status === "waiting",
		})),
	];
}

/** The team the shelf shows: kilo.core's when it lists workers, else the transcript's. */
export function shelfTeam(
	rootChatId: string,
	summary: SwarmSummary,
	activities: readonly SubagentActivity[],
): readonly TeamMember[] {
	if (summary.team.some((member) => !member.main)) return summary.team;
	return teamFromActivities(rootChatId, summary.team[0], activities);
}

/**
 * The composer's swarm shelf: the team's faces, then the one thing worth
 * reading — a worker waiting on the person (with Answer), else the newest
 * post, else how many work — and the way to the Swarm Board. It steps aside
 * once nobody works, nobody waits and the person has seen the newest post.
 */
export function SwarmShelf({
	board,
	summary,
	activities,
	onOpenBoard,
}: {
	readonly board: OpenSwarmBoard;
	readonly summary: SwarmSummary;
	readonly activities: readonly SubagentActivity[];
	/** Opens the board, counting the open. */
	readonly onOpenBoard: () => void;
}) {
	const openSubagent = useOpenSubagentPane();
	const team = shelfTeam(board.rootChatId, summary, activities);
	const workers = team.filter((member) => !member.main);
	const working = workers.filter((member) => isActive(member.state)).length;
	const done = workers.length - working;
	const waiting = workers.find((member) => member.needsYou);
	if (working === 0 && !waiting && summary.newCount === 0) return null;

	const name = (id: string, label?: string) => participantName(id, label, team);
	const latest = summary.latest;
	return (
		<div
			className="chat-composer-glass chat-composer-surface chat-composer-attached w-full overflow-hidden rounded-t-(--composer-radius)"
			data-composer-attached
			data-qa-id="kilo-composer-swarm-shelf"
		>
			<div className="bg-foreground/[0.035] flex min-w-0 items-center gap-3 px-3.5 py-[9px] text-[13px] leading-4">
				<SwarmFaces
					team={team}
					colors={summary.colors}
					className="*:data-[slot=avatar]:ring-[color-mix(in_srgb,var(--pane-raised,var(--card))_94%,transparent)]"
					faceQaId="kilo-composer-swarm-face"
					{...(openSubagent
						? {
								onOpen: (member: TeamMember) =>
									openSubagent(member.chatId, member.title, board.rootChatId),
							}
						: {})}
				/>
				<span
					className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden"
					data-qa-id="kilo-composer-swarm-line"
				>
					{waiting ? (
						<>
							<span className="text-foreground shrink-0 font-medium">{waiting.title}</span>
							<span className="text-muted-foreground/70 shrink-0">→</span>
							<span className="text-muted-foreground shrink-0">you</span>
							<span className="text-foreground/85 min-w-0 truncate">
								{needsYouSummary(waiting)}
							</span>
						</>
					) : latest ? (
						<>
							<span className="text-foreground max-w-[40%] shrink-0 truncate font-medium">
								{name(latest.from, latest.fromLabel)}
							</span>
							<span className="text-muted-foreground/70 shrink-0">→</span>
							<span className="text-muted-foreground max-w-[30%] shrink-0 truncate">
								{name(latest.to, latest.toLabel)}
							</span>
							<span className="text-foreground/85 min-w-0 truncate">{firstLine(latest.body)}</span>
						</>
					) : (
						<span className="text-muted-foreground truncate tabular-nums">
							{workCounts(working, done)}
						</span>
					)}
				</span>
				{waiting ? (
					<Button
						type="button"
						size="xs"
						className="shrink-0"
						onClick={() => {
							useSwarmBoardStore
								.getState()
								.requestFocus(board.rootChatId, { kind: "question", chatId: waiting.chatId });
							onOpenBoard();
						}}
						data-qa-id="kilo-composer-swarm-answer"
					>
						Answer
					</Button>
				) : null}
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground -me-1.5 flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 transition-colors"
					onClick={onOpenBoard}
					aria-label={summary.newCount > 0 ? `Swarm Board, ${summary.newCount} new` : "Swarm Board"}
					data-qa-id="kilo-composer-swarm-board"
				>
					Swarm Board
					{summary.newCount > 0 ? (
						<span
							className="bg-primary text-primary-foreground rounded-full px-1.5 text-[0.65rem] leading-4 font-semibold tabular-nums"
							data-qa-id="kilo-composer-swarm-board-unread"
						>
							{summary.newCount >= 50 ? "50+" : summary.newCount}
						</span>
					) : null}
					<ChevronRightIcon aria-hidden className="size-3" />
				</button>
			</div>
		</div>
	);
}
