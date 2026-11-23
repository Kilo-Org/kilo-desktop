import { ArrowUpIcon, MessagesSquareIcon } from "lucide-react";

import { KernelTelemetry } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { CHAT_TELEMETRY_EVENTS } from "../../contracts";
import { SwarmShelf } from "../swarm/SwarmShelf";
import { useSwarmPreferences } from "../swarm/swarm-preferences";
import { useOpenSwarmBoard } from "../swarm/use-open-swarm-board";
import { useSwarmAutoOpen } from "../swarm/use-swarm-auto-open";
import { useSwarmEnabled, useSwarmSummary } from "../swarm/use-swarm-summary";
import { COMPOSER_SHELF_HEADER_CLASS, ComposerShelf } from "../thread/composer-shelf";
import { useDelegationRevealStore } from "./delegation-reveal-store";
import { useSubagentActivity } from "./SubagentActivityContext";

/**
 * What sits above the composer once the chat has delegated to subagents: the
 * swarm shelf (faces, the newest post or who waits on the person, and the
 * Swarm Board) where the chat has a board and the person keeps the shelf on;
 * otherwise the one-line strip, which jumps to the first running delegation
 * row (the transcript's rows are where subagents are opened and stopped).
 * It also opens the board by itself when the swarm grows past the person's
 * threshold.
 */
export function ComposerSubagentStrip() {
	const { activities, activeActivities } = useSubagentActivity();
	const reveal = useDelegationRevealStore((state) => state.reveal);
	const shelfOn = useSwarmPreferences((state) => state.shelf);
	const board = useOpenSwarmBoard();
	const openBoard = useSwarmEnabled() ? board : null;
	const telemetry = useDomainObject(KernelTelemetry);
	const summary = useSwarmSummary(activities.length > 0 && openBoard ? openBoard.rootChatId : null);
	useSwarmAutoOpen(openBoard, activities.length, activeActivities.length);
	if (activities.length === 0) return null;

	const trackedOpen = () => {
		if (!openBoard) return;
		void telemetry?.methods
			.track({
				event: CHAT_TELEMETRY_EVENTS.swarmBoardOpened,
				data: { running: activeActivities.length },
			})
			.catch(() => undefined);
		openBoard.open();
	};
	if (shelfOn && openBoard && summary) {
		return (
			<SwarmShelf
				board={openBoard}
				summary={summary}
				activities={activities}
				onOpenBoard={trackedOpen}
			/>
		);
	}

	const first = activeActivities[0];
	const unread = summary?.newCount ?? 0;
	const label = first ? `${activeActivities.length} Running` : `${activities.length} Finished`;
	return (
		<ComposerShelf data-qa-id="kilo-composer-subagents">
			<div className="flex min-w-0 items-center">
				<button
					type="button"
					className={COMPOSER_SHELF_HEADER_CLASS}
					disabled={!first}
					onClick={() => first && reveal(first.toolCallId)}
					aria-label={first ? `Show subagents in chat: ${label}` : `Subagents: ${label}`}
					data-qa-id="kilo-composer-subagents-jump"
				>
					<span className="flex min-w-0 items-center gap-2">
						<span className="shrink-0">Subagents</span>
						<span className="text-foreground/70 flex items-center gap-1.5 font-normal">
							<span aria-hidden className="text-foreground/25">
								·
							</span>
							{first ? (
								<Spinner className="text-primary-ink size-3 shrink-0 motion-reduce:animate-none" />
							) : null}
							<span className="tabular-nums">{label}</span>
						</span>
					</span>
					{first ? <ArrowUpIcon aria-hidden className="size-3.5 shrink-0" /> : null}
				</button>
				{openBoard ? (
					<button
						type="button"
						className="text-foreground/70 hover:text-foreground flex shrink-0 items-center gap-1 px-2 text-xs"
						onClick={trackedOpen}
						aria-label={unread > 0 ? `Board, ${unread} new` : "Board"}
						data-qa-id="kilo-composer-swarm-board"
					>
						<MessagesSquareIcon aria-hidden className="size-3.5" />
						Board
						{unread > 0 ? (
							<span
								className="bg-primary text-primary-foreground rounded-full px-1.5 text-[0.65rem] leading-4 font-semibold tabular-nums"
								data-qa-id="kilo-composer-swarm-board-unread"
							>
								{unread >= 50 ? "50+" : unread}
							</span>
						) : null}
					</button>
				) : null}
			</div>
		</ComposerShelf>
	);
}
