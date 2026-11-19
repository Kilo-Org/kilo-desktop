import {
	PreviewCard,
	PreviewCardContent,
	PreviewCardTrigger,
} from "@kilo-desktop/ui/components/preview-card";
import { CircleAlertIcon, FolderIcon, GitBranchIcon, GitForkIcon, MonitorIcon } from "lucide-react";
import type { FC, ReactElement, ReactNode } from "react";

import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { type WorkSession } from "../../contracts";

import type { SessionActivity } from "./session-activity";
import { SessionRelativeTime } from "./session-row-display";
import { directoryBasename } from "../shared/directory";
import { WorkSessionDecoration } from "../../contracts";

type SessionRowHoverCardProps = {
	/** The row trigger; the card opens while it is hovered or focused. */
	trigger: ReactElement;
	session: WorkSession;
	title: string;
	activity: SessionActivity | undefined;
	locationLabel: string | null;
	workspaceColor: string | undefined;
};

export const SessionRowHoverCard: FC<SessionRowHoverCardProps> = ({ trigger, ...details }) => {
	return (
		<PreviewCard>
			<PreviewCardTrigger delay={600} closeDelay={150} render={trigger} />
			<PreviewCardContent
				side="right"
				align="start"
				sideOffset={10}
				data-qa-id="session-list-item-details"
				className="w-80 gap-3 p-3"
			>
				<SessionRowDetails {...details} />
			</PreviewCardContent>
		</PreviewCard>
	);
};

/**
 * The session's details on hover. `hover-branch` decorations (git's live
 * branch) take the place of the session's own branch line and `hover` ones
 * (git's pull request) follow the folder line; each renders its own line or
 * nothing. A chat's last failure shows until its next turn.
 */
const SessionRowDetails: FC<Omit<SessionRowHoverCardProps, "trigger">> = ({
	session,
	title,
	activity,
	locationLabel,
	workspaceColor,
}) => {
	const decorations = useExtensions(WorkSessionDecoration);
	const directory = activity?.directory;
	const branch = activity?.branch;
	const isWorktree = branch !== undefined;
	const renderSlot = (slot: "hover" | "hover-branch") => {
		const contributions = decorations.filter((decoration) => decoration.metadata.slot === slot);
		if (contributions.length === 0) return null;
		return contributions.map((decoration) => (
			<RenderContribution
				key={decoration.key}
				contribution={decoration}
				props={{ workSession: session }}
			/>
		));
	};

	return (
		<>
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
				{activity?.updatedAt !== undefined ? (
					<time
						dateTime={new Date(activity.updatedAt).toISOString()}
						title={new Date(activity.updatedAt).toLocaleString()}
						className="text-muted-foreground shrink-0 text-xs tabular-nums"
					>
						<SessionRelativeTime timestamp={activity.updatedAt} />
					</time>
				) : null}
			</div>
			<div className="flex min-w-0 flex-col gap-1.5 text-xs empty:hidden">
				{locationLabel ? (
					<SessionDetailItem
						icon={<FolderIcon aria-hidden {...(workspaceColor ? { color: workspaceColor } : {})} />}
					>
						{locationLabel}
					</SessionDetailItem>
				) : null}
				{renderSlot("hover-branch") ??
					(branch ? (
						<SessionDetailItem icon={<GitBranchIcon aria-hidden />}>{branch}</SessionDetailItem>
					) : null)}
				{directory ? (
					<SessionDetailItem
						icon={isWorktree ? <GitForkIcon aria-hidden /> : <MonitorIcon aria-hidden />}
					>
						{isWorktree ? directoryBasename(directory) : "Local"}
					</SessionDetailItem>
				) : null}
				{renderSlot("hover")}
				{activity?.lastError ? (
					<span data-qa-id="session-list-item-error" className="text-destructive">
						<SessionDetailItem icon={<CircleAlertIcon aria-hidden />}>
							{activity.lastError.message}
						</SessionDetailItem>
					</span>
				) : null}
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
