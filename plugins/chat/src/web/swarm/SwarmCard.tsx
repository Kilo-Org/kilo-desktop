import { CheckIcon, ChevronRightIcon } from "lucide-react";

import { KernelTelemetry } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";

import { CHAT_TELEMETRY_EVENTS } from "../../contracts";
import { SwarmFaces } from "./SwarmFaces";
import { workCounts, type SwarmSummary } from "./swarm-summary";
import { useOpenSwarmBoard } from "./use-open-swarm-board";
import { useSwarmEnabled, useSwarmSummary } from "./use-swarm-summary";

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function SwarmStatus({ summary }: { readonly summary: SwarmSummary }) {
	if (summary.needsYou.length > 0) {
		return (
			<span className="text-foreground flex items-center gap-1 font-medium">
				<span aria-hidden className="bg-foreground size-1.5 rounded-full" />
				{summary.needsYou.length} needs you
			</span>
		);
	}
	if (summary.live) {
		return (
			<span className="text-success flex items-center gap-1 font-medium">
				<span aria-hidden className="bg-success size-1.5 rounded-full motion-safe:animate-pulse" />
				Live
			</span>
		);
	}
	return (
		<span className="text-muted-foreground flex items-center gap-1">
			<CheckIcon aria-hidden className="size-3" />
			Done
		</span>
	);
}

/**
 * The chat's swarm under its delegations in the transcript: the team's faces,
 * how many work and post, and whether it is live, done or waiting on the
 * person. The whole card opens the Swarm Board. Nothing where the chat has no
 * board or kilo.core lists no workers for it.
 */
export function SwarmCard() {
	const board = useOpenSwarmBoard();
	const enabled = useSwarmEnabled();
	const telemetry = useDomainObject(KernelTelemetry);
	const summary = useSwarmSummary(enabled ? (board?.rootChatId ?? null) : null);
	if (!board || !summary) return null;
	const agents = summary.working + summary.done;
	if (agents === 0) return null;

	return (
		<button
			type="button"
			className="border-border-subtle hover:bg-muted/45 focus-visible:ring-ring/50 my-3 flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-start text-[13px] leading-4 transition-colors outline-none focus-visible:ring-2"
			aria-label="Open Swarm Board"
			onClick={() => {
				void telemetry?.methods
					.track({
						event: CHAT_TELEMETRY_EVENTS.swarmBoardOpened,
						data: { running: summary.working },
					})
					.catch(() => undefined);
				board.open();
			}}
			data-qa-id="kilo-swarm-card"
		>
			<SwarmFaces team={summary.team} colors={summary.colors} size="md" />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-foreground truncate text-sm leading-[18px] font-medium">
					Swarm Board · {plural(agents, "agent")}
				</span>
				<span
					className="text-muted-foreground truncate tabular-nums"
					data-qa-id="kilo-swarm-card-counts"
				>
					{workCounts(summary.working, summary.done)} · {plural(summary.posts, "post")}
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-1.5" data-qa-id="kilo-swarm-card-status">
				<SwarmStatus summary={summary} />
				<ChevronRightIcon aria-hidden className="text-muted-foreground ms-1.5 size-3.5" />
			</span>
		</button>
	);
}
