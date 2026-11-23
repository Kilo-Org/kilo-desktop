import { CircleDashedIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { DomainObjectHandle, DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	Chats,
	Swarm,
	type BackgroundJob,
	type SwarmTeam,
} from "@kilo-desktop/plugin-core/contracts";
import { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { teamColors, teamRootOf, tint } from "./swarm-colors";
import { AgentAvatar } from "./swarm-parts";
import { openSwarmBoardPane } from "./swarm-pane-actions";
import { displayTitle, rosterTeam, swarmTeam, type TeamMember } from "./swarm-team";
import { duration, useNow } from "./swarm-time";

const selectChats = (state: DomainObjectState<typeof Chats>) => state.chats;

/** What the worker's team reads from Kilo: its roster and the root's background jobs. */
interface TeamReads {
	readonly roster: SwarmTeam | null;
	readonly jobs: readonly BackgroundJob[];
}

const NO_READS: TeamReads = { roster: null, jobs: [] };

/**
 * A worker's team, color, title, whether it works and its member of the
 * team, as its team's board shows them: from kilo.core's chats and, for
 * workers it doesn't list yet, Kilo's roster of the team its pane names
 * (`parentHint`).
 */
export function useWorker(childChatId: string | undefined, parentHint: string | null) {
	const chats = useDomainObjectState(Chats, selectChats);
	const swarm = useDomainObject(Swarm);
	const known = childChatId ? chats?.[childChatId] : undefined;
	const root = known?.parentId && chats ? teamRootOf(childChatId!, chats) : parentHint;
	const [reads, setReads] = useState<TeamReads>(NO_READS);
	const childStatus = known?.activity.status;
	useEffect(
		() => readRoster(swarm, root, childChatId, childStatus, setReads),
		[childChatId, childStatus, root, swarm],
	);
	if (!childChatId || !root || root === childChatId) return undefined;
	const { roster, jobs } = reads;
	const listed = roster?.members.find((candidate) => candidate.chatId === childChatId);
	if (!known && !listed) return undefined;
	const color = teamColors(root, chats ?? {}, roster?.members ?? []).get(childChatId);
	if (!color) return undefined;
	const working = known
		? known.activity.status !== "idle"
		: listed?.state === "running" || listed?.state === "busy" || listed?.state === "retry";
	const isChild = (candidate: TeamMember) => candidate.chatId === childChatId;
	const member =
		(roster ? rosterTeam(root, chats ?? {}, roster, jobs).find(isChild) : undefined) ??
		swarmTeam(root, chats ?? {}, jobs).find(isChild);
	return {
		root,
		rootTitle: chats?.[root]?.title,
		color,
		title: known?.title ?? listed?.title ?? "Subagent",
		working,
		member,
	};
}

/**
 * Reads Kilo's roster of the worker's team and the root's background jobs
 * until the returned cleanup runs. `_childStatus` re-runs it whenever the
 * worker's activity changes.
 */
function readRoster(
	swarm: DomainObjectHandle<typeof Swarm> | null,
	root: string | null,
	childChatId: string | undefined,
	_childStatus: string | undefined,
	onReads: (reads: TeamReads) => void,
): (() => void) | undefined {
	if (!swarm || !root || root === childChatId) return;
	let live = true;
	void Promise.all([
		swarm.methods.team({ chatId: root }).catch(() => null),
		swarm.methods.jobs({ chatId: root }).catch(() => []),
	]).then(([roster, jobs]) => {
		if (live) onReads({ roster, jobs });
	});
	return () => {
		live = false;
	};
}

export type WorkerStatus = "Working" | "Needs you" | "Failed" | "Done" | "Stopped";

/** The board's words for a member's state; a prompt waiting on the person wins over "busy". */
export function workerStatus(
	member: TeamMember | undefined,
	working: boolean,
): WorkerStatus | undefined {
	if (!member) return working ? "Working" : undefined;
	if (member.needsYou) return "Needs you";
	switch (member.state) {
		case "working":
		case "retrying":
			return "Working";
		case "failed":
			return "Failed";
		case "done":
			return "Done";
		case "cancelled":
		case "stopped":
			return "Stopped";
		default:
			return undefined;
	}
}

const STATUS_TONE: Record<WorkerStatus, string> = {
	Working: "text-foreground",
	"Needs you": "text-warning",
	Failed: "text-destructive",
	Done: "text-success",
	Stopped: "text-muted-foreground",
};

/** `<aiProviderId>/<modelId>` as the model alone: what follows the last slash. */
export function shortModel(model: string): string {
	return model.slice(model.lastIndexOf("/") + 1) || model;
}

/**
 * The top of a worker's pane, in its team color: who it is, how it's doing,
 * the team it's part of (opening that team's Swarm Board), its model, how
 * long it has run, and Stop while a background job runs it.
 */
export function SubagentPaneHeader({
	workSessionId,
	childChatId,
	parentHint,
}: {
	readonly workSessionId: string;
	readonly childChatId: string | undefined;
	readonly parentHint: string | null;
}) {
	const worker = useWorker(childChatId, parentHint);
	const panes = useDomainObject(Panes);
	const swarm = useDomainObject(Swarm);
	const [stopping, setStopping] = useState<string | null>(null);
	const status = workerStatus(worker?.member, worker?.working ?? false);
	const now = useNow(status === "Working" ? 1_000 : 60_000);
	if (!worker) return null;
	const { member, root } = worker;
	const startedAt = member?.startedAt;
	const elapsed =
		startedAt !== undefined && startedAt > 0
			? duration((member?.completedAt ?? now) - startedAt)
			: undefined;
	const jobId = member?.jobId;

	const openBoard = () => {
		if (!panes) return;
		void openSwarmBoardPane(panes, workSessionId, root).catch(() =>
			toast.error("Could not open the Swarm Board"),
		);
	};
	const stop = () => {
		if (!swarm || !jobId) return;
		setStopping(jobId);
		void swarm.methods
			.cancelJob({ chatId: root, jobId })
			.catch((error: unknown) =>
				toast.error("Could not stop the agent", {
					description: error instanceof Error && error.message ? error.message : undefined,
				}),
			)
			.finally(() => setStopping(null));
	};

	return (
		<div
			className="flex min-w-0 items-center gap-2 border-b-2 px-3 py-1.5 text-sm"
			style={{ borderColor: worker.color, backgroundColor: tint(worker.color, 10) }}
			data-qa-id="subagent-pane-header"
			data-color={worker.color}
		>
			<AgentAvatar name={worker.title} color={worker.color} />
			<span className="truncate font-medium">{displayTitle(worker.title)}</span>
			{status ? (
				<span
					className={`flex shrink-0 items-center gap-1 text-xs font-medium ${STATUS_TONE[status]}`}
					data-qa-id="subagent-pane-status"
					data-status={status}
				>
					{status === "Working" ? (
						<CircleDashedIcon
							aria-hidden
							className="size-3 animate-spin [animation-duration:3s] motion-reduce:animate-none"
						/>
					) : null}
					{status}
				</span>
			) : null}
			<span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
				<span aria-hidden>·</span>
				<span className="flex min-w-0 items-center gap-1">
					<span className="shrink-0">Part of</span>
					<button
						type="button"
						className="hover:text-foreground truncate underline-offset-2 hover:underline disabled:no-underline"
						onClick={openBoard}
						disabled={!panes}
						title="Open the Swarm Board"
						data-qa-id="subagent-pane-swarm-link"
					>
						{worker.rootTitle ? displayTitle(worker.rootTitle) : "the main chat"}
					</button>
				</span>
				{member?.model ? (
					<>
						<span aria-hidden>·</span>
						<span className="truncate" title={member.model} data-qa-id="subagent-pane-model">
							{shortModel(member.model)}
						</span>
					</>
				) : null}
				{elapsed ? (
					<>
						<span aria-hidden>·</span>
						<span className="shrink-0 tabular-nums" data-qa-id="subagent-pane-elapsed">
							{elapsed}
						</span>
					</>
				) : null}
			</span>
			{jobId && swarm ? (
				<Button
					variant="ghost"
					size="xs"
					className="ms-auto shrink-0"
					onClick={stop}
					disabled={stopping === jobId}
					data-qa-id="subagent-pane-stop"
				>
					Stop
				</Button>
			) : null}
		</div>
	);
}
