import { PanelLeftCloseIcon } from "lucide-react";

import { KernelWindows, type WindowViewProps } from "@kilo-desktop/kernel";
import { useDomainObject, useSdk } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import type { WorkSession } from "../../contracts";
import { usePaneKinds } from "../shared/pane-kinds";
import { useWorkSession, useWorkSessionDirectory } from "../shared/use-active-work-session";
import { PaneView } from "./PaneView";
import { useWorkSessionPanes } from "./use-work-session-panes";

/**
 * A popped-out pane's window (kernel/window-view `pane`). Its header is the
 * window's drag region: `pl-20` clears the macOS traffic lights and the right
 * padding the Windows/Linux window controls. Docking closes the window; the
 * main window shows the pane again.
 */
export function PaneWindowView({ params }: WindowViewProps) {
	const { workSessionId = "", paneId = "" } = params;
	const workSession = useWorkSession(workSessionId);
	if (!workSession) return <PaneGone />;
	return <PaneWindowContent workSession={workSession} paneId={paneId} />;
}

function PaneWindowContent({
	workSession,
	paneId,
}: {
	readonly workSession: WorkSession;
	readonly paneId: string;
}) {
	const sdk = useSdk();
	const windows = useDomainObject(KernelWindows);
	const state = useWorkSessionPanes(workSession.id);
	const kinds = usePaneKinds();
	const directory = useWorkSessionDirectory(workSession);
	const pane = state.panes.find((candidate) => candidate.id === paneId);
	if (!pane) return <PaneGone />;
	const dock = () => {
		if (sdk.windowId) void windows?.methods.close({ windowId: sdk.windowId });
	};
	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col" data-qa-id="pane-window">
			<header
				data-qa-id="pane-window-header"
				className="drag-region border-border bg-card flex h-12 shrink-0 items-center gap-3 border-b pr-[calc(0.75rem+var(--window-controls-width))] pl-20"
			>
				<div className="flex min-w-0 flex-1 translate-y-0.5 items-baseline gap-2 text-sm">
					<span className="truncate font-medium">{pane.title}</span>
					<span className="text-muted-foreground truncate">{workSession.title}</span>
				</div>
				<Button
					variant="ghost"
					size="sm"
					data-qa-id="pane-window-dock"
					className="[-webkit-app-region:no-drag]"
					onClick={dock}
				>
					<PanelLeftCloseIcon data-icon="inline-start" />
					Dock
				</Button>
			</header>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<PaneView
					workSession={workSession}
					pane={pane}
					kinds={kinds}
					directory={directory}
					visible
				/>
			</main>
		</div>
	);
}

function PaneGone() {
	return (
		<div className="flex h-full items-center justify-center p-6" data-qa-id="pane-window-gone">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>This pane was closed</EmptyTitle>
					<EmptyDescription>You can close this window.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
