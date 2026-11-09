import { useMemo, useState, type ComponentType, type ReactNode } from "react";

import {
	KernelProvider,
	RenderContribution,
	useDomain,
	useExtensions,
	useKernel,
} from "@kilo-desktop/kernel/web";
import {
	isOrphanedWorktreeSession,
	WorkSessions,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { lastVisitedOf, useLastVisits } from "../attention/last-visited";
import { useChats } from "../attention/live-activity";
import { sessionActivities } from "../attention/session-chats";
import {
	activityOfSession,
	deriveSessionRowState,
	sessionStatus,
	type SessionActivity,
	type SessionRowState,
} from "./session-activity";
import { SESSION_LIST_STATUS_LABELS } from "./session-list-view";
import {
	removeSessionAndWorktree,
	reportFailure,
	SessionDeleteConfirmDialog,
	SessionDeleteWorktreeDialog,
	SessionRowMenu,
} from "./session-row-actions";
import { SESSION_ROW_STATE_LABELS, SessionRowGlyph } from "./session-row-display";
import {
	WORKBENCH_PLUGIN_ID,
	SessionDecoration,
	type SessionDecorationsProps,
	type SessionGlyphProps,
	type SessionMenuProps,
	type SessionRendererProps,
	type SessionRenderers,
} from "../../contracts";

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
	const sessions = useDomain(WorkSessions);
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
		const all = sessions?.getState().sessions ?? [];
		if (isOrphanedWorktreeSession(all, session.id)) setConfirmWorktreeDelete(true);
		else setConfirmDelete(true);
	};
	const removeWithWorktree = () => {
		if (!sessions) return;
		removeSessionAndWorktree(
			() => sessions.methods.remove({ id: session.id, removeWorktree: true }),
			session.worktreeBranch,
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
				worktreeBranch={session.worktreeBranch}
				onKeepWorktree={remove}
				onDeleteWorktree={removeWithWorktree}
			/>
		</>
	);
	return { togglePinned, setArchived, askToDelete, dialogs };
}

function SessionGlyph({ session, decorative = false }: SessionGlyphProps) {
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

function SessionStatusLabel({ session }: SessionRendererProps) {
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

function SessionDecorations({ session, slot, interactive = false }: SessionDecorationsProps) {
	const decorations = useExtensions(SessionDecoration).filter(
		(decoration) => decoration.metadata.slot === slot,
	);
	return (
		<>
			{decorations.map((decoration) => (
				<RenderContribution
					key={decoration.key}
					contribution={decoration}
					props={{ session, interactive }}
				/>
			))}
		</>
	);
}

function SessionMenuRenderer({ session, onRename, label, side, triggerRef }: SessionMenuProps) {
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
 * Renders a workbench component as kilo.workbench wherever it is shown: a
 * sessions view renders the session renderers inside its own plugin's tree.
 */
function asWorkbench<TProps extends object>(Inner: ComponentType<TProps>): ComponentType<TProps> {
	function AsWorkbench(props: TProps) {
		return (
			<KernelProvider kernel={useKernel()} as={WORKBENCH_PLUGIN_ID}>
				<Inner {...props} />
			</KernelProvider>
		);
	}
	AsWorkbench.displayName = `AsWorkbench(${Inner.displayName ?? Inner.name})`;
	return AsWorkbench;
}

/** How a session looks, handed to every sessions view (`SessionsViewProps.renderers`). */
export const SESSION_RENDERERS: SessionRenderers = {
	Glyph: asWorkbench(SessionGlyph),
	Status: asWorkbench(SessionStatusLabel),
	Decorations: asWorkbench(SessionDecorations),
	Menu: asWorkbench(SessionMenuRenderer),
};
