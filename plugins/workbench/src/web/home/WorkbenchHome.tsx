import type { Session } from "@kilo-desktop/plugin-sessions/contracts";

import { SessionCanvas } from "../panes/SessionCanvas";
import { SessionsViewInPlace, useShownSessionsView } from "../views/SessionsViewHost";
import { SessionPanePicker } from "../panes/SessionPaneControls";
import { WorkspaceSourceProvider } from "../workspace-source";
import { Launcher } from "./Launcher";
import { useActiveSession } from "./use-active-session";

/** The open session's workbench: its pane canvas and new-pane picker. */
function SessionWorkbench({ session }: { readonly session: Session }) {
	return (
		<div
			data-qa-id="session-workbench"
			data-session-id={session.id}
			className="flex min-h-0 min-w-0 flex-1 flex-col"
		>
			<SessionCanvas session={session} />
			<SessionPanePicker session={session} />
		</div>
	);
}

/**
 * kilo.workbench's home view (kilo.shell/main): a sessions view the navigator
 * shows, else the open session, else the launcher.
 */
export function WorkbenchHome() {
	const view = useShownSessionsView();
	const session = useActiveSession();
	return (
		<WorkspaceSourceProvider>
			{view ? (
				<SessionsViewInPlace view={view} />
			) : session ? (
				<SessionWorkbench session={session} />
			) : (
				<Launcher />
			)}
		</WorkspaceSourceProvider>
	);
}
