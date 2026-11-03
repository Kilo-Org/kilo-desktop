import { PanelLeftCloseIcon } from "lucide-react";
import { useCallback } from "react";

import { KernelWindows, type WindowViewProps } from "@kilo-desktop/kernel";
import { useDomain, useDomainState, useSdk } from "@kilo-desktop/kernel/web";
import { Sessions, type Session } from "@kilo-desktop/plugin-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { PaneView, useSessionDirectory } from "./PaneView";
import { useSessionPanes } from "./SessionCanvas";
import { usePaneKinds } from "./use-pane-kinds";

/**
 * A popped-out pane's window (kernel/window-view). Its header is the
 * window's drag region: `pl-20` clears the macOS traffic lights and the right
 * padding the Windows/Linux window controls. Docking closes the window; the
 * main window shows the pane again.
 */
export function PaneWindowView({ params }: WindowViewProps) {
	const { sessionId = "", paneId = "" } = params;
	const select = useCallback(
		(state: { sessions: readonly Session[] }) =>
			state.sessions.find((session) => session.id === sessionId) ?? null,
		[sessionId],
	);
	const session = useDomainState(Sessions, select) ?? null;
	if (!session) return <PaneGone />;
	return <PaneWindowContent session={session} paneId={paneId} />;
}

function PaneWindowContent({
	session,
	paneId,
}: {
	readonly session: Session;
	readonly paneId: string;
}) {
	const sdk = useSdk();
	const windows = useDomain(KernelWindows);
	const state = useSessionPanes(session.id);
	const kinds = usePaneKinds();
	const directory = useSessionDirectory(session);
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
					<span className="text-muted-foreground truncate">{session.title}</span>
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
				<PaneView session={session} pane={pane} kinds={kinds} directory={directory} visible />
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
