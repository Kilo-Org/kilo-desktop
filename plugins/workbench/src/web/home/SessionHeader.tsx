import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { SessionDecoration } from "@kilo-desktop/plugin-sessions/contracts";

import { SessionAction } from "../../contracts";
import { SessionPaneControls } from "../panes/SessionPaneControls";
import {
	SessionsViewHeaderActions,
	SessionsViewHeaderLeading,
	useShownSessionsView,
} from "../views/SessionsViewHost";
import { directoryBasename } from "../list/session-activity";
import { SessionLocationBreadcrumb } from "./SessionLocationBreadcrumb";
import { useActiveSession, useSessionWorkspace } from "./use-active-session";

/** The window header's leading content while a sessions view shows or a session is open. */
export function SessionHeaderLeading() {
	const view = useShownSessionsView();
	if (view) return <SessionsViewHeaderLeading view={view} />;
	return <OpenSessionHeaderLeading />;
}

function OpenSessionHeaderLeading() {
	const session = useActiveSession();
	const workspace = useSessionWorkspace(session);
	if (!session) return null;
	// A deleted workspace still names the session's place by its folder.
	const locationLabel =
		workspace?.name ??
		(session.workspaceId && session.directory ? directoryBasename(session.directory) : null);
	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<SessionLocationBreadcrumb
				locationLabel={locationLabel}
				locationColor={workspace?.color}
				title={session.title}
				qaId="session-breadcrumb"
			/>
		</div>
	);
}

/**
 * The window header's actions while a session is open: plugins' header
 * decorations (kilo.sessions/session-decoration) and `start` session actions,
 * then the carousel toggle and "+", then `end` session actions
 * (kilo.workbench/session-action).
 */
export function SessionHeaderActions() {
	const view = useShownSessionsView();
	if (view) return <SessionsViewHeaderActions view={view} />;
	return <OpenSessionHeaderActions />;
}

function OpenSessionHeaderActions() {
	const session = useActiveSession();
	const decorations = useExtensions(SessionDecoration).filter(
		(decoration) => decoration.metadata.slot === "header",
	);
	const actions = useExtensions(SessionAction);
	if (!session) return null;
	const renderActions = (placement: "start" | "end") =>
		actions
			.filter((action) => action.metadata.placement === placement)
			.map((action) => (
				<RenderContribution
					key={`${session.id}:${action.key}`}
					contribution={action}
					props={{ session }}
				/>
			));
	return (
		<div
			className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]"
			data-qa-id="session-header-actions"
		>
			{decorations.map((decoration) => (
				<RenderContribution
					key={`${session.id}:${decoration.key}`}
					contribution={decoration}
					props={{ session }}
				/>
			))}
			{renderActions("start")}
			<SessionPaneControls session={session} />
			{renderActions("end")}
		</div>
	);
}
