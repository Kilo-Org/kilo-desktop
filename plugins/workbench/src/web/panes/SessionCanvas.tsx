import { useCallback, useMemo, useState } from "react";

import { KernelWindows } from "@kilo-desktop/kernel";
import { useContextKey, useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { findPaneGroup, serializeLayout, type PaneLayout } from "@kilo-desktop/pane-layout";
import {
	EMPTY_SESSION_PANES,
	Panes,
	type Session,
	type SessionPanes,
} from "@kilo-desktop/plugin-sessions/contracts";
import { SHELL_CANVAS_ATTRIBUTE } from "@kilo-desktop/plugin-shell/contracts";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { PaneCanvas } from "../canvas/PaneCanvas";
import type { CanvasPaneKind } from "../canvas/types";
import { reportFailure } from "../list/session-row-actions";
import { useShortcutHints } from "../shortcut-hints";
import { useWorkbenchTelemetry } from "../telemetry";
import { closePane, launchPaneForPerson, panesInOrder, saveLayout } from "./pane-actions";
import { sessionLayout } from "./session-layout";
import { PaneView, useSessionDirectory } from "./PaneView";
import { popOut, usePoppedOutPanes } from "./pop-outs";
import { implementationOf, usePaneKinds } from "./use-pane-kinds";

/** A session's panes, as kilo.sessions holds them. */
export function useSessionPanes(sessionId: string): SessionPanes {
	const select = useCallback(
		(state: { bySession: Readonly<Record<string, SessionPanes>> }) =>
			state.bySession[sessionId] ?? EMPTY_SESSION_PANES,
		[sessionId],
	);
	return useDomainState(Panes, select) ?? EMPTY_SESSION_PANES;
}

/**
 * The open session's pane canvas. kilo.sessions holds which panes exist;
 * the canvas arranges them. A layout change shows at once and is saved to
 * kilo.sessions, so every window follows; this window's unsaved layout gives
 * way as soon as the saved one changes.
 */
export function SessionCanvas({ session }: { readonly session: Session }) {
	const panes = useDomain(Panes);
	const state = useSessionPanes(session.id);
	const kinds = usePaneKinds();
	const track = useWorkbenchTelemetry();
	const directory = useSessionDirectory(session);
	const windows = useDomain(KernelWindows);
	const desktop = useContextKey("kernel/desktop");
	const poppedOut = usePoppedOutPanes(session.id);
	const canPopOut = desktop && windows !== null;
	const derived = useMemo(() => sessionLayout(state, kinds.layoutKindOf), [kinds, state]);
	const [pending, setPending] = useState<{ basis: SessionPanes; layout: PaneLayout } | null>(null);
	const layout = pending?.basis === state ? pending.layout : derived;
	const paneOrder = useMemo(() => panesInOrder(layout), [layout]);
	const shortcutHints = useShortcutHints("pane", paneOrder);

	const changeLayout = (next: PaneLayout) => {
		if (!panes || serializeLayout(next) === serializeLayout(layout)) return;
		setPending({ basis: state, layout: next });
		void saveLayout(panes, session.id, next).catch(
			reportFailure("Could not save the layout", "The panes went back to where they were."),
		);
	};
	const failed = (action: string) => reportFailure(`Could not ${action}`, "Nothing changed.");

	const renderPane = (paneId: string) => {
		const pane = state.panes.find((candidate) => candidate.id === paneId);
		if (!pane) return null;
		return (
			<PaneView
				session={session}
				pane={pane}
				kinds={kinds}
				directory={directory}
				visible={findPaneGroup(layout, paneId)?.activePaneId === paneId}
			/>
		);
	};

	const launch = (kind: CanvasPaneKind, targetGroupId?: string) => {
		if (!panes) return;
		void launchPaneForPerson(
			track,
			panes,
			session.id,
			kind.id,
			kinds.layoutKindOf,
			targetGroupId ? { into: targetGroupId } : undefined,
		).catch(failed(`open ${kind.title}`));
	};

	if (state.panes.length === 0) return <EmptySession />;
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
						.activate({ sessionId: session.id, paneId })
						.catch(failed("show the pane"))
				}
				onClosePane={(paneId) => {
					if (!panes) return;
					void closePane(
						panes,
						session.id,
						paneId,
						(kind) => implementationOf(kinds.byKey.get(kind)),
						track,
					).catch(failed("close the pane"));
				}}
				onLaunch={launch}
				renderPane={renderPane}
				shortcutHints={shortcutHints}
				{...(canPopOut
					? {
							poppedOutPaneIds: new Set(poppedOut.keys()),
							onPopOutPane: (paneId: string) => {
								const pane = state.panes.find((candidate) => candidate.id === paneId);
								if (pane && windows) {
									void popOut(windows, session.id, pane).catch(failed("pop out the pane"));
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
					const pane = state.panes.find((candidate) => candidate.id === paneId);
					const Icon = implementationOf(kinds.byKey.get(pane?.kind ?? ""))?.icon;
					return Icon ? { Icon, ...(pane?.iconKey ? { iconKey: pane.iconKey } : {}) } : undefined;
				}}
			/>
		</div>
	);
}

function EmptySession() {
	return (
		<div data-qa-id="session-empty" className="flex min-h-0 flex-1 items-center justify-center p-6">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Nothing open in this session</EmptyTitle>
					<EmptyDescription>Open a pane with + in the header.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
