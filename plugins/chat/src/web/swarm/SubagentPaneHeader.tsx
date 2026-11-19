import { useEffect, useState } from "react";

import type { DomainObjectHandle, DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats, Swarm, type SwarmTeam } from "@kilo-desktop/plugin-core/contracts";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { teamColors, teamRootOf, tint } from "./swarm-colors";
import { AgentAvatar } from "./swarm-parts";

const selectChats = (state: DomainObjectState<typeof Chats>) => state.chats;

/**
 * A worker's team, color, title and whether it works, as its team's board
 * shows them: from kilo.core's chats and, for workers it doesn't list yet,
 * Kilo's roster of the team its pane names (`parentHint`).
 */
export function useWorker(childChatId: string | undefined, parentHint: string | null) {
	const chats = useDomainObjectState(Chats, selectChats);
	const swarm = useDomainObject(Swarm);
	const known = childChatId ? chats?.[childChatId] : undefined;
	const root = known?.parentId && chats ? teamRootOf(childChatId!, chats) : parentHint;
	const [roster, setRoster] = useState<SwarmTeam | null>(null);
	const childStatus = known?.activity.status;
	useEffect(
		() => readRoster(swarm, root, childChatId, childStatus, setRoster),
		[childChatId, childStatus, root, swarm],
	);
	if (!childChatId || !root || root === childChatId) return undefined;
	const member = roster?.members.find((candidate) => candidate.chatId === childChatId);
	if (!known && !member) return undefined;
	const color = teamColors(root, chats ?? {}, roster?.members ?? []).get(childChatId);
	if (!color) return undefined;
	const working = known
		? known.activity.status !== "idle"
		: member?.state === "running" || member?.state === "busy" || member?.state === "retry";
	return { root, color, title: known?.title ?? member?.title ?? "Subagent", working };
}

/**
 * Reads Kilo's roster of the worker's team until the returned cleanup runs.
 * `_childStatus` re-runs it whenever the worker's activity changes.
 */
function readRoster(
	swarm: DomainObjectHandle<typeof Swarm> | null,
	root: string | null,
	childChatId: string | undefined,
	_childStatus: string | undefined,
	onRoster: (team: SwarmTeam | null) => void,
): (() => void) | undefined {
	if (!swarm || !root || root === childChatId) return;
	let live = true;
	void swarm.methods
		.team({ chatId: root })
		.then((team) => {
			if (live) onRoster(team);
		})
		.catch(() => undefined);
	return () => {
		live = false;
	};
}

/** The top of a worker's pane: its avatar and name in its team color. */
export function SubagentPaneHeader({
	childChatId,
	parentHint,
}: {
	readonly childChatId: string | undefined;
	readonly parentHint: string | null;
}) {
	const worker = useWorker(childChatId, parentHint);
	if (!worker) return null;
	return (
		<div
			className="flex min-w-0 items-center gap-2 border-b-2 px-3 py-1.5 text-sm"
			style={{ borderColor: worker.color, backgroundColor: tint(worker.color, 10) }}
			data-qa-id="subagent-pane-header"
			data-color={worker.color}
		>
			<AgentAvatar name={worker.title} color={worker.color} />
			<span className="truncate font-medium">{worker.title}</span>
			<span className="text-muted-foreground ms-auto flex shrink-0 items-center gap-1 text-xs">
				{worker.working ? <Spinner className="size-3 motion-reduce:animate-none" /> : null}
				{worker.working ? "Working" : "Idle"}
			</span>
		</div>
	);
}
