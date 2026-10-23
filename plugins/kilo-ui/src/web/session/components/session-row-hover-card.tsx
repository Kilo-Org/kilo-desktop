"use client";

import {
	PreviewCard,
	PreviewCardContent,
	PreviewCardTrigger,
} from "@kilo-desktop/ui/components/preview-card";
import { useSdkContributions } from "@kilo-desktop/sdk-react";
import { ThreadListItemPrimitive } from "@assistant-ui/react";
import { FolderIcon, GitBranchIcon, GitForkIcon, MonitorIcon } from "lucide-react";
import type { FC, ReactElement, ReactNode } from "react";

import {
	directoryBasename,
	formatRelativeTimeLabel,
	type SessionActivity,
} from "../activity/session-activity-logic.js";
import { UNTITLED_SESSION_TITLE } from "../session-title.js";

export const SESSION_DETAILS_BRANCH_ZONE = "kilo-ui/chat-session-details-branch";
export const SESSION_DETAILS_PULL_REQUEST_ZONE = "kilo-ui/chat-session-details-pull-request";

/** Props every `chat-session-details-*` zone contribution receives. */
export type SessionDetailsZoneProps = {
	statusId: string;
	directory: string;
	worktreeBranch?: string;
};

type SessionRowHoverCardProps = {
	/** The row trigger; the card opens while it is hovered or focused. */
	trigger: ReactElement;
	activity: SessionActivity | undefined;
	locationLabel: string | null;
	workspaceColor: string | undefined;
	statusId: string | null;
};

export const SessionRowHoverCard: FC<SessionRowHoverCardProps> = ({ trigger, ...details }) => {
	return (
		<PreviewCard>
			<PreviewCardTrigger delay={600} closeDelay={150} render={trigger} />
			<PreviewCardContent
				side="right"
				align="start"
				sideOffset={10}
				data-slot="aui_session-list-item-details"
				className="w-80 gap-3 p-3"
			>
				<SessionRowDetails {...details} />
			</PreviewCardContent>
		</PreviewCard>
	);
};

const SessionRowDetails: FC<Omit<SessionRowHoverCardProps, "trigger">> = ({
	activity,
	locationLabel,
	workspaceColor,
	statusId,
}) => {
	const branchContributions = useSdkContributions(SESSION_DETAILS_BRANCH_ZONE);
	const pullRequestContributions = useSdkContributions(SESSION_DETAILS_PULL_REQUEST_ZONE);
	const directory = activity?.directory;
	const worktreeBranch = activity?.worktreeBranch;
	const zoneProps: SessionDetailsZoneProps | null =
		statusId && directory
			? { statusId, directory, ...(worktreeBranch ? { worktreeBranch } : {}) }
			: null;
	const renderZone = (contributions: ReturnType<typeof useSdkContributions>) =>
		zoneProps && contributions.length > 0
			? contributions.map((contribution) => {
					const Component = contribution.component as FC<SessionDetailsZoneProps>;
					return <Component key={`${contribution.featureId}.${contribution.id}`} {...zoneProps} />;
				})
			: null;
	const isWorktree = worktreeBranch !== undefined;

	return (
		<>
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="min-w-0 flex-1 truncate font-medium">
					<ThreadListItemPrimitive.Title fallback={UNTITLED_SESSION_TITLE} />
				</span>
				{activity?.updatedAt !== undefined ? (
					<time
						dateTime={new Date(activity.updatedAt).toISOString()}
						title={new Date(activity.updatedAt).toLocaleString()}
						className="text-muted-foreground shrink-0 text-xs tabular-nums"
					>
						{formatRelativeTimeLabel(activity.updatedAt, Date.now())}
					</time>
				) : null}
			</div>
			{/* Zone contributions render their own `SessionDetailItem`-shaped
			    line, or nothing when they have no value. */}
			<div className="flex min-w-0 flex-col gap-1.5 text-xs empty:hidden">
				{locationLabel ? (
					<SessionDetailItem
						icon={<FolderIcon aria-hidden {...(workspaceColor ? { color: workspaceColor } : {})} />}
					>
						{locationLabel}
					</SessionDetailItem>
				) : null}
				{renderZone(branchContributions) ??
					(worktreeBranch ? (
						<SessionDetailItem icon={<GitBranchIcon aria-hidden />}>
							{worktreeBranch}
						</SessionDetailItem>
					) : null)}
				{directory ? (
					<SessionDetailItem
						icon={isWorktree ? <GitForkIcon aria-hidden /> : <MonitorIcon aria-hidden />}
					>
						{isWorktree ? directoryBasename(directory) : "Local"}
					</SessionDetailItem>
				) : null}
				{renderZone(pullRequestContributions)}
			</div>
		</>
	);
};

const SessionDetailItem: FC<{ icon: ReactNode; children: ReactNode }> = ({ icon, children }) => (
	<span className="flex min-w-0 items-center gap-1.5">
		<span className="flex shrink-0 opacity-70 [&_svg]:size-3">{icon}</span>
		<span className="truncate">{children}</span>
	</span>
);
