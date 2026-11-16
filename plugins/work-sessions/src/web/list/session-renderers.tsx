import { useMemo, useState, type ComponentType, type ReactNode } from "react";

import {
	KernelProvider,
	RenderContribution,
	useDomainObject,
	useExtensions,
	useKernel,
} from "@kilo-desktop/kernel/web";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	isOrphanedCopySession,
	WORK_SESSIONS_PLUGIN_ID,
	WorkSessionDecoration,
	WorkSessions,
	type WorkSession,
	type WorkSessionDecorationsProps,
	type WorkSessionGlyphProps,
	type WorkSessionMenuProps,
	type WorkSessionRendererProps,
	type WorkSessionRenderers,
} from "../../contracts";
import { lastVisitedOf, useLastVisits } from "../attention/last-visited";
import { useChats } from "../attention/live-activity";
import { sessionActivities } from "../attention/session-chats";
import { reportFailure } from "../shared/report-failure";
import {
	activityOfSession,
	deriveSessionRowState,
	sessionStatus,
	type SessionActivity,
	type SessionRowState,
} from "./session-activity";
import { SESSION_LIST_STATUS_LABELS } from "./session-list-view";
import {
	removeSessionAndCopy,
	SessionDeleteConfirmDialog,
	SessionDeleteWorktreeDialog,
	SessionRowMenu,
} from "./session-row-actions";
import { SESSION_ROW_STATE_LABELS, SessionRowGlyph } from "./session-row-display";
/*
 * The session renderers: a session as the session list shows it, handed to
 * sessions views (a board card). The row itself uses the same actions.
 */

/** A session's live activity (from its chats) and the row state this window shows. */
export function useSessionRowState(session: WorkSession): {
	activity: SessionActivity;
	rowState: SessionRowState;
} {
	const chats = useChats();
	const visits = useLastVisits();
	const activity = useMemo(
		() => sessionActivities([session], chats)[session.id] ?? activityOfSession(session),
		[chats, session],
	);
	return { activity, rowState: deriveSessionRowState(activity, lastVisitedOf(visits, session)) };
}

/**
 * A session's built-in actions from Session methods: pin, archive or
 * restore, and delete behind its confirmation (with the worktree choice for
 * the last session in a worktree). `dialogs` must be rendered.
 */
export function useSessionActions(session: WorkSession): {
	togglePinned: () => void;
	setArchived: (archived: boolean) => void;
	askToDelete: () => void;
	dialogs: ReactNode;
} {
	const sessions = useDomainObject(WorkSessions);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [confirmWorktreeDelete, setConfirmWorktreeDelete] = useState(false);
	const togglePinned = () =>
		void sessions?.methods
			.setPinned({ id: session.id, pinned: !session.pinned })
			.catch(reportFailure("Could not pin session", "The session was not changed."));
	const setArchived = (archived: boolean) =>
		void sessions?.methods
			.setArchived({ id: session.id, archived })
			.catch(
				reportFailure(
					archived ? "Could not archive session" : "Could not restore session",
					"The session was not changed.",
				),
			);
	const remove = () =>
		void sessions?.methods
			.remove({ id: session.id })
			.catch(reportFailure("Could not delete session", "The session was not deleted."));
	const askToDelete = () => {
		const all = sessions?.getState().workSessions ?? [];
		if (isOrphanedCopySession(all, session.id)) setConfirmWorktreeDelete(true);
		else setConfirmDelete(true);
	};
	const removeWithWorktree = () => {
		if (!sessions) return;
		removeSessionAndCopy(
			() => sessions.methods.remove({ id: session.id, removeCopy: true }),
			session.branch,
		);
	};
	const dialogs = (
		<>
			<SessionDeleteConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				onConfirm={remove}
				title={session.title}
			/>
			<SessionDeleteWorktreeDialog
				open={confirmWorktreeDelete}
				onOpenChange={setConfirmWorktreeDelete}
				title={session.title}
				branch={session.branch}
				onKeepWorktree={remove}
				onDeleteWorktree={removeWithWorktree}
			/>
		</>
	);
	return { togglePinned, setArchived, askToDelete, dialogs };
}

function SessionGlyph({ workSession: session, decorative = false }: WorkSessionGlyphProps) {
	const { activity, rowState } = useSessionRowState(session);
	return (
		<SessionRowGlyph
			rowState={rowState}
			isActive={false}
			workingSince={activity.workingSince}
			decorative={decorative}
		/>
	);
}

function SessionStatusLabel({ workSession: session }: WorkSessionRendererProps) {
	const { rowState } = useSessionRowState(session);
	const status = sessionStatus(session.archived, rowState);
	const { label, className } =
		status === "archived" || status === "idle"
			? { label: SESSION_LIST_STATUS_LABELS[status], className: "" }
			: SESSION_ROW_STATE_LABELS[status];
	return (
		<span data-qa-id="session-status" data-status={status} className={cn("truncate", className)}>
			{label}
		</span>
	);
}

function SessionDecorations({
	workSession,
	slot,
	interactive = false,
}: WorkSessionDecorationsProps) {
	const decorations = useExtensions(WorkSessionDecoration).filter(
		(decoration) => decoration.metadata.slot === slot,
	);
	return (
		<>
			{decorations.map((decoration) => (
				<RenderContribution
					key={decoration.key}
					contribution={decoration}
					props={{ workSession, interactive }}
				/>
			))}
		</>
	);
}

function SessionMenuRenderer({
	workSession: session,
	onRename,
	label,
	side,
	triggerRef,
}: WorkSessionMenuProps) {
	const { togglePinned, setArchived, askToDelete, dialogs } = useSessionActions(session);
	return (
		<>
			<SessionRowMenu
				session={session}
				onPin={togglePinned}
				onRename={onRename}
				onArchive={() => setArchived(true)}
				onRestore={() => setArchived(false)}
				onDelete={askToDelete}
				triggerRef={triggerRef}
				{...(label ? { label } : {})}
				{...(side ? { side } : {})}
			/>
			{dialogs}
		</>
	);
}

/**
 * Renders a component as kilo.work-sessions wherever it is shown: a
 * sessions view renders the session renderers inside its own plugin's tree.
 */
function asWorkSessions<TProps extends object>(
	Inner: ComponentType<TProps>,
): ComponentType<TProps> {
	function AsWorkSessions(props: TProps) {
		return (
			<KernelProvider kernel={useKernel()} as={WORK_SESSIONS_PLUGIN_ID}>
				<Inner {...props} />
			</KernelProvider>
		);
	}
	AsWorkSessions.displayName = `AsWorkSessions(${Inner.displayName ?? Inner.name})`;
	return AsWorkSessions;
}

/** How a session looks, handed to every sessions view (`SessionsViewProps.renderers`). */
export const WORK_SESSION_RENDERERS: WorkSessionRenderers = {
	Glyph: asWorkSessions(SessionGlyph),
	Status: asWorkSessions(SessionStatusLabel),
	Decorations: asWorkSessions(SessionDecorations),
	Menu: asWorkSessions(SessionMenuRenderer),
};
