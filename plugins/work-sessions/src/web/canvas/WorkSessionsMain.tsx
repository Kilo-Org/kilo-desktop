import type { WorkSession } from "../../contracts";
import { NewWorkSessionPage } from "../home/NewWorkSessionPage";
import { SessionCanvas } from "../panes/SessionCanvas";
import { SessionPanePicker } from "../panes/SessionPaneControls";
import { useActiveWorkSession } from "../shared/use-active-work-session";
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

/**
 * kilo.work-sessions' main area (`kilo.shell/main`): the work sessions view
 * the window shows, else the open work session, else the New Session page.
 */
export function WorkSessionsMain() {
	const view = useShownWorkSessionsView();
	const workSession = useActiveWorkSession();
	return (
		<WorkspaceSourceProvider>
			{view ? (
				<WorkSessionsViewInPlace view={view} />
			) : workSession ? (
				<OpenWorkSession workSession={workSession} />
			) : (
				<NewWorkSessionPage />
			)}
		</WorkspaceSourceProvider>
	);
}
