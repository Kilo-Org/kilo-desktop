import { MessageSquareIcon } from "lucide-react";
import type { FC, PointerEvent as ReactPointerEvent, PointerEventHandler, RefObject } from "react";

import { useSdkContributions } from "@kilo-desktop/sdk-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kilo-desktop/ui/components/card";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { Workspace } from "../../../contracts/workspaces/schemas.js";
import { SESSION_LIST_STATUS_LABELS } from "../session-list/session-list-view.js";
import { workspaceGlyphColor } from "../../workspaces/workspace-glyph-style.js";
import {
	SESSION_ROW_STATE_LABELS,
	SessionRelativeTime,
	SessionRowGlyph,
	type SessionRowMetadataProps,
} from "../components/assistant-ui/session-row-display.js";
import { useRenameState } from "../components/assistant-ui/session-row-actions.js";
import {
	resolveSessionLocationLabel,
	sessionGitStatusId,
} from "../session-activity/session-activity-logic.js";
import {
	boardCardStatus,
	type BoardCardStatus,
	type BoardSession,
} from "./workspace-board-sessions.js";

/**
 * The chat actions a card offers, supplied by the board page: they act on the
 * chat through assistant-ui. Optional so the board renders without a chat
 * runtime, which is the seam its drag-and-drop tests use.
 */
export type WorkspaceBoardCardActions = {
	Menu: FC<{
		session: BoardSession;
		triggerRef: RefObject<HTMLButtonElement | null>;
		onRename: () => void;
	}>;
	Rename: FC<{ session: BoardSession; onDone: (restoreFocus: boolean) => void }>;
};

type WorkspaceBoardCardProps = {
	session: BoardSession;
	workspaces: readonly Workspace[];
	actions: WorkspaceBoardCardActions | undefined;
	onDragPointerDown: PointerEventHandler<HTMLElement>;
	onOpen: (session: BoardSession) => void;
};

/**
 * The whole card opens its chat through a stretched button beneath the content.
 * The content layers are positioned so they paint above that button, and are
 * pointer-transparent except for their own controls (actions menu, rename field,
 * row-metadata links), which therefore receive their own hover, tooltip and click.
 */
export const WorkspaceBoardCard: FC<WorkspaceBoardCardProps> = ({
	session,
	workspaces,
	actions,
	onDragPointerDown,
	onOpen,
}) => {
	const { activity } = session;
	const { isRenaming, startRename, finishRename, triggerRef } = useRenameState();
	const locationLabel = resolveSessionLocationLabel(activity, workspaces);
	const workspace = workspaces.find((candidate) => candidate.id === activity?.workspaceId);
	const workspaceColor = workspaceGlyphColor(workspace?.color);
	const statusId = sessionGitStatusId(activity);
	const metadataContributions = useSdkContributions("kilo-ui/chat-session-row-metadata");
	const status = boardCardStatus(session);
	const statusLabel = cardStatusLabel(status);
	const showMetadata = Boolean(statusId && activity?.directory && metadataContributions.length > 0);

	return (
		<li
			data-workspace-board-card
			data-session-id={session.sessionId}
			data-qa-id={`workspace-board-card-${session.sessionId}`}
			className="touch-none list-none"
			onPointerDown={onDragPointerDown}
		>
			<Card size="sm" className="hover:ring-foreground/20 relative gap-1 py-2.5 transition-shadow">
				<button
					type="button"
					data-qa-id="workspace-board-card-open"
					aria-label={
						locationLabel ? `Open ${session.title} in ${locationLabel}` : `Open ${session.title}`
					}
					title={locationLabel ? `${session.title}\n${locationLabel}` : session.title}
					className="focus-visible:ring-ring/50 absolute inset-0 cursor-pointer rounded-[inherit] outline-none focus-visible:ring-3 focus-visible:ring-inset"
					onClick={() => onOpen(session)}
				/>
				{/* Flex rows instead of the header grid, so the details row spans the full
				    width and its status text aligns across cards. */}
				<CardHeader className="pointer-events-none relative flex flex-col gap-1">
					<CardTitle className="flex h-5 w-full min-w-0 items-center gap-2 font-normal">
						<span data-board-drag-icon className="flex shrink-0">
							{session.rowState ? (
								<SessionRowGlyph
									rowState={session.rowState}
									isActive={false}
									workingSince={activity?.workingSince}
									decorative
								/>
							) : (
								// The icon carries the workspace colour in place of a workspace name.
								<MessageSquareIcon
									aria-hidden
									className="text-muted-foreground size-3.5 shrink-0"
									{...(workspaceColor ? { color: workspaceColor } : {})}
								/>
							)}
						</span>
						{isRenaming && actions ? (
							<span className="pointer-events-auto flex min-w-0 flex-1" onPointerDown={stopDrag}>
								<actions.Rename session={session} onDone={finishRename} />
							</span>
						) : (
							<span
								data-qa-id="workspace-board-card-title"
								className={cn(
									"min-w-0 flex-1 truncate",
									status === "archived" && "text-muted-foreground",
								)}
							>
								{session.title}
							</span>
						)}
						{actions && !isRenaming ? (
							// In the flow so the title truncates before it once shown. Collapsed rather
							// than display:none so its button stays focusable (Tab, focus restore after
							// rename); stays open while its menu is open so the menu keeps an anchor.
							<span className={cardActionsClassName} onPointerDown={stopDrag}>
								<actions.Menu session={session} triggerRef={triggerRef} onRename={startRename} />
							</span>
						) : null}
					</CardTitle>
					<CardDescription className="flex h-4 w-full min-w-0 items-center gap-2 text-xs">
						<span
							data-qa-id="workspace-board-card-status"
							className={cn("shrink-0", statusLabel.className)}
						>
							{statusLabel.label}
						</span>
						{activity?.updatedAt !== undefined ? (
							<span className="ml-auto shrink-0 tabular-nums">
								<SessionRelativeTime timestamp={activity.updatedAt} />
							</span>
						) : null}
					</CardDescription>
				</CardHeader>
				{showMetadata ? (
					// Contributions render nothing for chats without a PR; `empty:hidden` drops the row and its gap.
					<CardContent className="relative flex min-w-0 flex-wrap items-center gap-1 text-xs empty:hidden">
						{metadataContributions.map((contribution) => {
							const Component = contribution.component as FC<SessionRowMetadataProps>;
							return (
								<Component
									key={`${contribution.featureId}.${contribution.id}`}
									statusId={statusId!}
									directory={activity!.directory!}
									{...(activity?.worktreeBranch ? { worktreeBranch: activity.worktreeBranch } : {})}
								/>
							);
						})}
					</CardContent>
				) : null}
			</Card>
		</li>
	);
};

function cardStatusLabel(status: BoardCardStatus): { label: string; className: string } {
	if (status === "archived" || status === "idle") {
		return { label: SESSION_LIST_STATUS_LABELS[status], className: "" };
	}
	return SESSION_ROW_STATE_LABELS[status];
}

const cardActionsClassName = cn(
	"pointer-events-auto flex -ml-2 w-0 overflow-hidden opacity-0 transition-opacity motion-reduce:transition-none",
	"group-hover/card:ml-0 group-hover/card:-mr-1 group-hover/card:w-auto group-hover/card:overflow-visible group-hover/card:opacity-100",
	"has-[:focus-visible]:ml-0 has-[:focus-visible]:-mr-1 has-[:focus-visible]:w-auto has-[:focus-visible]:overflow-visible has-[:focus-visible]:opacity-100",
	"has-[[data-popup-open]]:ml-0 has-[[data-popup-open]]:-mr-1 has-[[data-popup-open]]:w-auto has-[[data-popup-open]]:overflow-visible has-[[data-popup-open]]:opacity-100",
);

/** The card's own controls keep their pointer behaviour instead of starting a drag. */
function stopDrag(event: ReactPointerEvent) {
	event.stopPropagation();
}
