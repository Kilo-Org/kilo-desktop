import { Activity, useState } from "react";

import type { WorkSession } from "../../contracts";
import { NewWorkSessionPage } from "../home/NewWorkSessionPage";
import { SessionCanvas } from "../panes/SessionCanvas";
import { SessionPanePicker } from "../panes/SessionPaneControls";
import { useActiveWorkSession, useWorkSession } from "../shared/use-active-work-session";
import { WorkspaceSourceProvider } from "../shared/workspace-source";
import { useShownWorkSessionsView, WorkSessionsViewInPlace } from "../views/WorkSessionsViewHost";

/** The open work session: its pane canvas and new-pane picker. */
function OpenWorkSession({ workSession }: { readonly workSession: WorkSession }) {
	return (
		<div
			data-qa-id="session-workbench"
			data-session-id={workSession.id}
			className="flex min-h-0 min-w-0 flex-1 flex-col"
		>
			<SessionCanvas workSession={workSession} />
			<SessionPanePicker workSession={workSession} />
		</div>
	);
}

/** Work sessions kept mounted once left, most recent first, including the open one. */
const KEPT_WORK_SESSIONS = 3;

/**
 * The ids of the last `KEPT_WORK_SESSIONS` work sessions opened, the open one
 * first. Closing the open one (back to the New Session page) lets it go;
 * changing to another session or a view keeps it.
 */
function useRecentWorkSessionIds(openId: string | null, closed: boolean): readonly string[] {
	const [tracked, setTracked] = useState<RecentWorkSessions>(NO_RECENT_WORK_SESSIONS);
	const next = advanceRecentWorkSessions(tracked, openId, closed);
	if (next !== tracked) setTracked(next);
	return next.recent;
}

interface RecentWorkSessions {
	readonly recent: readonly string[];
	/** The work session open at the previous render. */
	readonly last: string | null;
}

const NO_RECENT_WORK_SESSIONS: RecentWorkSessions = { recent: [], last: null };

/** `previous` after rendering with `openId`, or `previous` itself when nothing changed. */
function advanceRecentWorkSessions(
	previous: RecentWorkSessions,
	openId: string | null,
	closed: boolean,
): RecentWorkSessions {
	let recent = previous.recent;
	if (openId !== null && recent[0] !== openId) {
		recent = [openId, ...recent.filter((id) => id !== openId)].slice(0, KEPT_WORK_SESSIONS);
	} else if (closed && previous.last !== null) {
		const closedId = previous.last;
		recent = recent.filter((id) => id !== closedId);
	}
	if (recent === previous.recent && openId === previous.last) return previous;
	return { recent, last: openId };
}

/**
 * A recently opened work session, shown while open and kept mounted but hidden otherwise.
 *
 * The `hidden` wrapper sits outside the `Activity` so it changes in the same
 * commit as the page shown instead: the shell ignores a canvas marker under a
 * `hidden` element, and a hidden session's DOM (marker included) stays in the page.
 */
function KeptWorkSession({ id, shown }: { readonly id: string; readonly shown: boolean }) {
	const workSession = useWorkSession(id);
	if (!workSession) return null;
	return (
		<div hidden={!shown} className="contents">
			<Activity mode={shown ? "visible" : "hidden"}>
				<OpenWorkSession workSession={workSession} />
			</Activity>
		</div>
	);
}

/**
 * kilo.work-sessions' main area (`kilo.shell/main`): the work sessions view
 * the window shows, else the open work session, else the New Session page.
 *
 * The last few work sessions opened stay mounted under a hidden `Activity`:
 * changing back to one shows its panes as they were (transcripts, terminals,
 * scroll positions) instead of building every pane again. Hidden sessions
 * keep their DOM and state, but their effects are disconnected and their
 * updates run at idle priority, so they cost memory, not time.
 */
export function WorkSessionsMain() {
	const view = useShownWorkSessionsView();
	const workSession = useActiveWorkSession();
	const openId = view ? null : (workSession?.id ?? null);
	const recent = useRecentWorkSessionIds(openId, !view && !workSession);
	return (
		<WorkspaceSourceProvider>
			{view ? <WorkSessionsViewInPlace view={view} /> : workSession ? null : <NewWorkSessionPage />}
			{recent.map((id) => (
				<KeptWorkSession key={id} id={id} shown={id === openId} />
			))}
		</WorkspaceSourceProvider>
	);
}
