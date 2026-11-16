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

/** The top bar's title while a work session is open (`session-title`): its workspace and title. */
export function WorkSessionTopBarTitle() {
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
 * The top bar's actions while a work session is open (`session-actions`):
 * plugins' `start` work session actions, then "+", then `end` ones
 * (`kilo.work-sessions/work-session-action`), then the carousel toggle.
 */
export function WorkSessionTopBarActions() {
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
			<SessionPaneControls workSession={workSession}>{renderActions("end")}</SessionPaneControls>
		</div>
	);
}

/** The shown work sessions view's title in the top bar (`view-title`). */
export function ViewTopBarTitle() {
	const view = useShownWorkSessionsView();
	return view ? <WorkSessionsViewHeaderLeading view={view} /> : null;
}

/** The shown work sessions view's actions in the top bar (`view-actions`). */
export function ViewTopBarActions() {
	const view = useShownWorkSessionsView();
	return view ? <WorkSessionsViewHeaderActions view={view} /> : null;
}
