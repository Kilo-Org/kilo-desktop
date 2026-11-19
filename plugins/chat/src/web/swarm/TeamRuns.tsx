import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";

import { duration } from "./swarm-time";
import { TeamSequenceChart } from "./TeamSequenceChart";
import type { Timeline } from "./team-timeline";

const time = (timestamp: number) =>
	new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Inferred activity periods, with the latest open and earlier periods folded.
 * These are quiet-gap groupings of loaded history, not recorded agent turns
 * (the Timeline tab's Key says so).
 */
export function TeamRuns({
	runs,
	messages,
	mainChatId,
	colorOf,
	nameOf,
	onJump,
}: {
	readonly runs: readonly Timeline[];
	/** Loaded posts to plot; filtering is owned by the caller. */
	readonly messages: readonly BoardMessage[];
	readonly mainChatId: string;
	readonly colorOf: (chatId: string) => string;
	readonly nameOf: (id: string, label?: string) => string;
	readonly onJump: (messageId: string) => void;
}) {
	/** Periods the person opened or folded, by start time; the latest starts open. */
	const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(new Map());
	if (runs.length === 0) {
		return (
			<p className="text-muted-foreground py-4 text-sm">
				No dated activity in the loaded history yet.
			</p>
		);
	}
	const chart = (run: Timeline) => (
		<TeamSequenceChart
			timeline={run}
			messages={messages}
			mainChatId={mainChatId}
			colorOf={colorOf}
			nameOf={nameOf}
			onJump={onJump}
		/>
	);
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<ol className="flex min-w-0 flex-col gap-3" data-qa-id="swarm-runs">
				{runs.map((run, index) => {
					const latest = index === runs.length - 1;
					const open = toggled.get(run.from) ?? latest;
					const agents = run.lanes.filter((lane) => lane.chatId !== mainChatId).length;
					return (
						<li key={run.from} className="min-w-0" data-qa-id="swarm-run">
							<Collapsible
								open={open}
								onOpenChange={(value) =>
									setToggled((current) => new Map(current).set(run.from, value))
								}
							>
								<CollapsibleTrigger
									render={<Button variant="ghost" />}
									className="h-auto min-h-10 w-full min-w-0 justify-start gap-2 px-1 py-2 text-start whitespace-normal"
									data-qa-id="swarm-run-toggle"
								>
									{open ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
									<span className="flex min-w-0 flex-1 flex-col gap-1">
										<span>Activity period {index + 1}</span>
										{run.live ? (
											<span className="text-muted-foreground text-xs">Ongoing</span>
										) : null}
										<span className="text-muted-foreground text-xs tabular-nums">
											{time(run.from)}–{time(run.to)} · {duration(run.to - run.from)} ·{" "}
											{agents === 1 ? "1 agent" : `${agents} agents`} ·{" "}
											{run.postCount === 1 ? "1 loaded post" : `${run.postCount} loaded posts`}
										</span>
									</span>
								</CollapsibleTrigger>
								<CollapsibleContent>{chart(run)}</CollapsibleContent>
							</Collapsible>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
