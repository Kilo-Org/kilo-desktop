import type { ReactNode } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";

import { Panes, type WorkSession } from "../../contracts";
import { NewPanePicker } from "../canvas/NewPanePicker";
import { PaneLaunchToolbar } from "../canvas/PaneLaunchToolbar";
import { PaneSessionChrome } from "../canvas/PaneSessionChrome";
import { launchPane, setArrangement, type PanePlacement } from "../shared/pane-actions";
import { usePaneKinds } from "../shared/pane-kinds";
import { reportFailure } from "../shared/report-failure";
import { useTracker } from "../shared/telemetry";
import { panePicker, usePanePicker } from "./pane-picker";
import { useWorkSessionPanes } from "./use-work-session-panes";

function useLaunch(workSession: WorkSession) {
	const panes = useDomainObject(Panes);
	const kinds = usePaneKinds();
	return {
		kinds,
		launch: (kindId: string, title: string, placement?: PanePlacement) => {
			if (!panes) return;
			void launchPane(panes, workSession.id, kindId, kinds.layoutKindOf, placement).catch(
				reportFailure(`Could not open ${title}`, "Nothing changed."),
			);
		},
	};
}

/**
 * The open work session's header controls: "+" and pinned kinds for a new
 * pane, then `children` (plugins' `end` actions), then the carousel toggle, last.
 */
export function SessionPaneControls({
	workSession,
	children,
}: {
	readonly workSession: WorkSession;
	readonly children?: ReactNode;
}) {
	const panes = useDomainObject(Panes);
	const state = useWorkSessionPanes(workSession.id);
	const { kinds, launch } = useLaunch(workSession);
	const track = useTracker();
	const addable = kinds.inSession.some((kind) => kind.addable);
	return (
		<>
			{addable ? (
				<PaneLaunchToolbar
					kinds={kinds.inSession}
					// The header "+" adds a tab group; other launches add a tab.
					onLaunch={(kind) => launch(kind.id, kind.title, { beside: "after" })}
				/>
			) : null}
			{children}
			{state.panes.length > 0 ? (
				<PaneSessionChrome
					arrangement={state.arrangement}
					onArrangementChange={(arrangement) => {
						if (!panes) return;
						void setArrangement(panes, workSession.id, arrangement, track).catch(
							reportFailure("Could not change the arrangement", "Nothing changed."),
						);
					}}
				/>
			) : null}
		</>
	);
}

/** The new-pane picker (⌘T, new group right / below), for the open work session. */
export function SessionPanePicker({ workSession }: { readonly workSession: WorkSession }) {
	const request = usePanePicker();
	const { kinds, launch } = useLaunch(workSession);
	return (
		<NewPanePicker
			open={request !== null}
			onOpenChange={(open) => {
				if (!open) panePicker.close();
			}}
			title={request?.title ?? "New tab"}
			kinds={kinds.inSession}
			onLaunch={(kind) => launch(kind.id, kind.title, request?.placement)}
		/>
	);
}
