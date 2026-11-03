import { useDomain } from "@kilo-desktop/kernel/web";
import { Panes, type Session } from "@kilo-desktop/plugin-sessions/contracts";

import { NewPanePicker } from "../canvas/NewPanePicker";
import { PaneLaunchToolbar } from "../canvas/PaneLaunchToolbar";
import { PaneSessionChrome } from "../canvas/PaneSessionChrome";
import { reportFailure } from "../list/session-row-actions";
import { useWorkbenchTelemetry } from "../telemetry";
import { launchPaneForPerson, setArrangement, type PanePlacement } from "./pane-actions";
import { panePicker, usePanePicker } from "./pane-picker";
import { useSessionPanes } from "./SessionCanvas";
import { usePaneKinds } from "./use-pane-kinds";

function useLaunch(session: Session) {
	const panes = useDomain(Panes);
	const kinds = usePaneKinds();
	const track = useWorkbenchTelemetry();
	return {
		kinds,
		launch: (kindId: string, title: string, placement?: PanePlacement) => {
			if (!panes) return;
			void launchPaneForPerson(
				track,
				panes,
				session.id,
				kindId,
				kinds.layoutKindOf,
				placement,
			).catch(reportFailure(`Could not open ${title}`, "Nothing changed."));
		},
	};
}

/** The open session's header controls: "+" and pinned kinds for a new pane, then the carousel toggle. */
export function SessionPaneControls({ session }: { readonly session: Session }) {
	const panes = useDomain(Panes);
	const state = useSessionPanes(session.id);
	const { kinds, launch } = useLaunch(session);
	const track = useWorkbenchTelemetry();
	const addable = kinds.inSession.some((kind) => kind.addable);
	return (
		<>
			{addable ? (
				<PaneLaunchToolbar
					kinds={kinds.inSession}
					onLaunch={(kind) => launch(kind.id, kind.title)}
				/>
			) : null}
			{state.panes.length > 0 ? (
				<PaneSessionChrome
					arrangement={state.arrangement}
					onArrangementChange={(arrangement) => {
						if (!panes) return;
						void setArrangement(panes, session.id, arrangement, track).catch(
							reportFailure("Could not change the arrangement", "Nothing changed."),
						);
					}}
				/>
			) : null}
		</>
	);
}

/** The new-pane picker (⌘T, new group right / below), for the open session. */
export function SessionPanePicker({ session }: { readonly session: Session }) {
	const request = usePanePicker();
	const { kinds, launch } = useLaunch(session);
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
