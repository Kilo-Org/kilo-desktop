import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";

import { WorkSessionAction } from "../../contracts";
import { SessionPaneControls } from "../panes/SessionPaneControls";
import { directoryBasename } from "../shared/directory";
import { useActiveWorkSession, useWorkSessionWorkspace } from "../shared/use-active-work-session";
import {
	WorkSessionsViewHeaderActions,
	WorkSessionsViewHeaderLeading,
	useShownWorkSessionsView,
} from "../views/WorkSessionsViewHost";
import { SessionLocationBreadcrumb } from "./SessionLocationBreadcrumb";

/** The window header's leading content while a work sessions view shows or a work session is open. */
export function WorkSessionHeaderLeading() {
	const view = useShownWorkSessionsView();
	if (view) return <WorkSessionsViewHeaderLeading view={view} />;
	return <OpenWorkSessionHeaderLeading />;
}

function OpenWorkSessionHeaderLeading() {
	const workSession = useActiveWorkSession();
	const workspace = useWorkSessionWorkspace(workSession);
	if (!workSession) return null;
	// A deleted workspace still names the work session's place by its folder.
	const locationLabel =
		workspace?.name ??
		(workSession.workspaceId && workSession.directory
			? directoryBasename(workSession.directory)
			: null);
	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<SessionLocationBreadcrumb
				locationLabel={locationLabel}
				locationColor={workspace?.color}
				title={workSession.title}
				qaId="session-breadcrumb"
			/>
		</div>
	);
}

/**
 * The window header's actions while a work session is open: plugins'
 * `start` work session actions, then "+" and the carousel toggle, then `end`
 * ones (`kilo.work-sessions/work-session-action`).
 */
export function WorkSessionHeaderActions() {
	const view = useShownWorkSessionsView();
	if (view) return <WorkSessionsViewHeaderActions view={view} />;
	return <OpenWorkSessionHeaderActions />;
}

function OpenWorkSessionHeaderActions() {
	const workSession = useActiveWorkSession();
	const actions = useExtensions(WorkSessionAction);
	if (!workSession) return null;
	const renderActions = (placement: "start" | "end") =>
		actions
			.filter((action) => action.metadata.placement === placement)
			.map((action) => (
				<RenderContribution
					key={`${workSession.id}:${action.key}`}
					contribution={action}
					props={{ workSession }}
				/>
			));
	return (
		<div
			className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]"
			data-qa-id="session-header-actions"
		>
			{renderActions("start")}
			<SessionPaneControls workSession={workSession} />
			{renderActions("end")}
		</div>
	);
}
