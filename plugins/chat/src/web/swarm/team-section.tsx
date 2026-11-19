import {
	CheckIcon,
	CircleAlertIcon,
	CircleSlashIcon,
	RotateCwIcon,
	SquareIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { AgentAvatar } from "./swarm-parts";
import { isActive, type MemberState, type TeamMember } from "./swarm-team";
import { duration, useNow } from "./swarm-time";

const time = (timestamp: number) =>
	new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const STATE_LABEL: Record<MemberState, string> = {
	working: "Working",
	retrying: "Retrying",
	idle: "Idle",
	done: "Done",
	failed: "Failed",
	cancelled: "Cancelled",
	stopped: "Stopped",
	unknown: "Unknown",
};

const STATE_HINT: Partial<Record<MemberState, string>> = {
	retrying: "The model provider is failing or rate-limiting; Kilo is retrying.",
	stopped: "A restart cut it off before it finished.",
	unknown: "Nothing reports what this agent is doing.",
};

export const STATE_TONE: Record<MemberState, string> = {
	working: "text-primary-ink",
	retrying: "text-warning",
	idle: "text-muted-foreground",
	done: "text-success",
	failed: "text-destructive",
	cancelled: "text-muted-foreground",
	stopped: "text-muted-foreground",
	unknown: "text-muted-foreground/70",
};

export function StateIcon({ state }: { readonly state: MemberState }) {
	switch (state) {
		case "working":
			return <Spinner className="size-3 motion-reduce:animate-none" />;
		case "retrying":
			return <RotateCwIcon aria-hidden className="size-3" />;
		case "done":
			return <CheckIcon aria-hidden className="size-3" />;
		case "failed":
			return <CircleAlertIcon aria-hidden className="size-3" />;
		case "cancelled":
			return <CircleSlashIcon aria-hidden className="size-3" />;
		case "stopped":
			return <span aria-hidden className="size-2 rounded-full border border-current" />;
		default:
			return null;
	}
}

/** A task-first team row; secondary metadata stays in its keyboard-accessible details. */
/** How long a member has been running, ticking while shown. */
function RunningFor({ startedAt }: { readonly startedAt: number }) {
	const now = useNow(1_000);
	return duration(now - startedAt);
}

export function TeamRow({
	member,
	color,
	canOpen,
	onOpen,
	onStop,
	lastPost,
}: {
	readonly member: TeamMember;
	readonly color: string;
	readonly canOpen: boolean;
	readonly onOpen: () => void;
	readonly onStop: (() => void) | undefined;
	/** Its newest board post, shown in details. */
	readonly lastPost?: string | undefined;
}) {
	const [open, setOpen] = useState(false);
	const active = isActive(member.state);
	const attentionLabel = member.attention?.includes("permission")
		? member.attention.includes("question")
			? "Review permission and question"
			: "Review permission request"
		: member.attention?.includes("question")
			? "Answer question"
			: "Needs your attention";
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="border-border flex min-w-0 flex-col border-b py-2 last:border-b-0"
			data-qa-id="swarm-team-row"
			data-state={member.state}
		>
			<div className="flex min-w-0 items-start gap-2 text-sm">
				<CollapsibleTrigger
					render={<Button size="icon" variant="ghost" />}
					aria-label={`${open ? "Hide" : "Show"} details for ${member.main ? "Main agent" : member.title}`}
					title={`${open ? "Hide" : "Show"} details`}
					data-qa-id="swarm-team-member-details-toggle"
				>
					<AgentAvatar name={member.main ? "Main" : member.title} color={color} />
				</CollapsibleTrigger>
				<div className="flex min-w-0 flex-1 flex-col items-start gap-1">
					<Button
						variant="ghost"
						className="h-auto min-h-8 w-full min-w-0 justify-start px-1 py-1 text-start [overflow-wrap:anywhere] whitespace-normal"
						disabled={!canOpen}
						onClick={onOpen}
						data-qa-id="swarm-team-member"
						aria-label={`Open ${member.main ? "Main agent" : member.title} transcript`}
					>
						{member.main ? "Main agent" : member.title}
					</Button>
					<div className="flex w-full flex-wrap items-center gap-2">
						<span
							className={cn("flex items-center gap-1 px-1 text-xs", STATE_TONE[member.state])}
							title={STATE_HINT[member.state]}
							data-qa-id="swarm-team-member-state"
						>
							<StateIcon state={member.state} />
							{STATE_LABEL[member.state]}
						</span>
						{onStop ? (
							<Button
								variant="ghost"
								aria-label={`Stop ${member.title}`}
								data-qa-id="swarm-job-cancel"
								onClick={onStop}
							>
								<SquareIcon data-icon="inline-start" />
								Stop
							</Button>
						) : null}
					</div>
					{member.needsYou ? (
						<Button
							variant="outline"
							className="h-auto min-h-8 max-w-full py-1 whitespace-normal"
							disabled={!canOpen}
							onClick={onOpen}
							data-qa-id="swarm-team-member-needs-you"
						>
							<CircleAlertIcon data-icon="inline-start" />
							{attentionLabel}
						</Button>
					) : null}
				</div>
			</div>
			{member.error && !open ? (
				<p
					className="text-destructive ps-2 pt-1 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap"
					data-qa-id="swarm-team-member-error"
				>
					{member.error}
				</p>
			) : null}
			<CollapsibleContent>
				<dl
					className="text-muted-foreground grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 pt-3 pb-1 text-sm"
					data-qa-id="swarm-team-member-details"
				>
					{member.main ? (
						<>
							<dt>Task</dt>
							<dd className="text-foreground [overflow-wrap:anywhere]">{member.title}</dd>
						</>
					) : null}
					{member.agent ? (
						<>
							<dt>Agent type</dt>
							<dd
								className="text-foreground [overflow-wrap:anywhere]"
								data-qa-id="swarm-team-member-agent"
							>
								{member.agent}
							</dd>
						</>
					) : null}
					{member.startedAt ? (
						<>
							<dt>Started</dt>
							<dd className="text-foreground tabular-nums">{time(member.startedAt)}</dd>
						</>
					) : null}
					{member.completedAt ? (
						<>
							<dt>Finished</dt>
							<dd className="text-foreground tabular-nums">
								{time(member.completedAt)}
								{member.startedAt
									? ` · took ${duration(member.completedAt - member.startedAt)}`
									: ""}
							</dd>
						</>
					) : active && member.startedAt ? (
						<>
							<dt>Running for</dt>
							<dd className="text-foreground tabular-nums">
								<RunningFor startedAt={member.startedAt} />
							</dd>
						</>
					) : null}
					{member.model ? (
						<>
							<dt>Model</dt>
							<dd
								className="text-foreground [overflow-wrap:anywhere]"
								data-qa-id="swarm-team-member-model"
							>
								{member.model}
							</dd>
						</>
					) : null}
					{member.main || member.background === undefined ? null : (
						<>
							<dt>Runs</dt>
							<dd className="text-foreground">
								{member.background ? "In the background" : "While the main agent waits"}
							</dd>
						</>
					)}
					{member.error ? (
						<>
							<dt>Error</dt>
							<dd className="text-destructive wrap-break-word whitespace-pre-wrap">
								{member.error}
							</dd>
						</>
					) : null}
					{lastPost ? (
						<>
							<dt>Latest post</dt>
							<dd className="text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap">
								{lastPost}
							</dd>
						</>
					) : null}
				</dl>
			</CollapsibleContent>
		</Collapsible>
	);
}
