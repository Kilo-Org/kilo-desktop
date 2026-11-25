import { WaypointsIcon } from "lucide-react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import type { WorkSessionDecorationProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { sessionSwarmState, swarmLabel } from "./session-swarm";

/**
 * The work session row's swarm glyph (`status` decoration): shown once a chat of
 * the work session has delegated to subagents, with a dot in the text color
 * while one waits on the person, green while any works, and none once all
 * finished. Never interactive: it sits inside the row's button.
 */
export function SwarmSessionDecoration({ workSession }: WorkSessionDecorationProps) {
	// A string, so the row re-renders only when the counts change.
	const key =
		useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) => {
			const { subagents, working, needsYou } = sessionSwarmState(workSession.chatIds, state.chats);
			return `${subagents}:${working}:${needsYou}`;
		}) ?? "0:0:0";
	const [subagents = 0, working = 0, needsYou = 0] = key.split(":").map(Number);
	if (subagents === 0) return null;
	const label = swarmLabel({ subagents, working, needsYou });
	const dot = needsYou > 0 ? "needs-you" : working > 0 ? "working" : null;
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className="text-muted-foreground flex shrink-0 items-center gap-1.5"
			data-qa-id="kilo-swarm-session-decoration"
			data-state={dot ?? "finished"}
		>
			<WaypointsIcon aria-hidden className="size-3.5" />
			{dot ? (
				<span
					aria-hidden
					className={cn(
						"size-1.5 rounded-full",
						dot === "needs-you" ? "bg-foreground" : "bg-success",
					)}
				/>
			) : null}
		</span>
	);
}
