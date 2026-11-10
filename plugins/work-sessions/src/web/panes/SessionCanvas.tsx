import { useMemo, useState } from "react";

import { KernelWindows } from "@kilo-desktop/kernel";
import { useContextKey, useDomainObject } from "@kilo-desktop/kernel/web";
import { findPaneGroup, serializeLayout, type PaneLayout } from "@kilo-desktop/pane-layout";
import { SHELL_CANVAS_ATTRIBUTE } from "@kilo-desktop/plugin-shell/contracts";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { Panes, type WorkSession, type WorkSessionPanes } from "../../contracts";
import { PaneCanvas } from "../canvas/PaneCanvas";
import { closePane, launchPane, panesInOrder, saveLayout } from "../shared/pane-actions";
import { implementationOf, usePaneKinds, type CanvasPaneKind } from "../shared/pane-kinds";
import { reportFailure } from "../shared/report-failure";
import { sessionLayout } from "../shared/session-layout";
import { useShortcutHints } from "../shared/shortcut-hints";
import { useWorkSessionDirectory } from "../shared/use-active-work-session";
import { PaneView } from "./PaneView";
import { popOut, usePoppedOutPanes } from "./pop-outs";
import { useWorkSessionPanes } from "./use-work-session-panes";

/**
 * The open work session's pane canvas. The panes domain object holds which
 * panes exist; the canvas arranges them. A layout change shows at once and
 * is saved to the panes domain object, so every window follows; this
 * window's unsaved layout gives way as soon as the saved one changes.
 */
export function SessionCanvas({ workSession }: { readonly workSession: WorkSession }) {
	const panes = useDomainObject(Panes);
	const state = useWorkSessionPanes(workSession.id);
	const kinds = usePaneKinds();
	const directory = useWorkSessionDirectory(workSession);
	const windows = useDomainObject(KernelWindows);
	const desktop = useContextKey("kernel/desktop");
	const poppedOut = usePoppedOutPanes(workSession.id);
	const canPopOut = desktop && windows !== null;
	const derived = useMemo(() => sessionLayout(state, kinds.layoutKindOf), [kinds, state]);
	const [pending, setPending] = useState<{ basis: WorkSessionPanes; layout: PaneLayout } | null>(
		null,
	);
	const layout = pending?.basis === state ? pending.layout : derived;
	const paneOrder = useMemo(() => panesInOrder(layout), [layout]);
	const shortcutHints = useShortcutHints("pane", paneOrder);

	const changeLayout = (next: PaneLayout) => {
		if (!panes || serializeLayout(next) === serializeLayout(layout)) return;
		setPending({ basis: state, layout: next });
		void saveLayout(panes, workSession.id, next).catch(
			reportFailure("Could not save the layout", "The panes went back to where they were."),
		);
	};
	const failed = (action: string) => reportFailure(`Could not ${action}`, "Nothing changed.");
	const paneOf = (paneId: string) => state.panes.find((candidate) => candidate.id === paneId);

	const renderPane = (paneId: string) => {
		const pane = paneOf(paneId);
		if (!pane) return null;
		return (
			<PaneView
				workSession={workSession}
				pane={pane}
				kinds={kinds}
				directory={directory}
				visible={findPaneGroup(layout, paneId)?.activePaneId === paneId}
			/>
		);
	};

	const launch = (kind: CanvasPaneKind, targetGroupId?: string) => {
		if (!panes) return;
		void launchPane(
			panes,
			workSession.id,
			kind.id,
			kinds.layoutKindOf,
			targetGroupId ? { into: targetGroupId } : undefined,
		).catch(failed(`open ${kind.title}`));
	};

	if (state.panes.length === 0) return <EmptySession hasKinds={kinds.inSession.length > 0} />;
	return (
		// Islands carry their own surfaces, so the shell drops its card. The negative
		// top margin cancels the groups' drop-zone padding, leaving the islands'
		// top edge where a bare page's would be.
		<div
			data-qa-id="session-canvas"
			{...{ [SHELL_CANVAS_ATTRIBUTE]: "" }}
			className="relative -mt-0.5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-1.5 pt-0"
		>
			<PaneCanvas
				layout={layout}
				arrangement={state.arrangement}
				kinds={kinds.inSession}
				onLayoutChange={changeLayout}
				onSelectPane={(paneId) =>
					void panes?.methods
						.activate({ workSessionId: workSession.id, paneId })
						.catch(failed("show the pane"))
				}
				onClosePane={(paneId) => {
					if (!panes) return;
					void closePane(panes, workSession.id, paneId, (kind) =>
						implementationOf(kinds.byKey.get(kind)),
					).catch(failed("close the pane"));
				}}
				onLaunch={launch}
				renderPane={renderPane}
				shortcutHints={shortcutHints}
				statusForPane={(paneId) => paneOf(paneId)?.status}
				{...(canPopOut
					? {
							poppedOutPaneIds: new Set(poppedOut.keys()),
							onPopOutPane: (paneId: string) => {
								const pane = paneOf(paneId);
								if (pane && windows) {
									void popOut(windows, workSession.id, pane).catch(failed("pop out the pane"));
								}
							},
							onFocusPoppedOutPane: (paneId: string) => {
								const windowId = poppedOut.get(paneId);
								if (windowId)
									void windows?.methods.focus({ windowId }).catch(failed("show the window"));
							},
							onDockPoppedOutPane: (paneId: string) => {
								const windowId = poppedOut.get(paneId);
								if (windowId)
									void windows?.methods.close({ windowId }).catch(failed("dock the pane"));
							},
						}
					: {})}
				iconForPane={(paneId) => {
					const pane = paneOf(paneId);
					const Icon = implementationOf(kinds.byKey.get(pane?.kind ?? ""))?.icon;
					return Icon ? { Icon, ...(pane?.iconKey ? { iconKey: pane.iconKey } : {}) } : undefined;
				}}
			/>
		</div>
	);
}

/** No panes yet: how to open one, or that no plugin contributes a kind of pane. */
function EmptySession({ hasKinds }: { readonly hasKinds: boolean }) {
	return (
		<div data-qa-id="session-empty" className="flex min-h-0 flex-1 items-center justify-center p-6">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Nothing open in this session</EmptyTitle>
					<EmptyDescription>
						{hasKinds
							? "Open a pane with + in the header."
							: "No installed plugin adds panes to sessions yet."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
