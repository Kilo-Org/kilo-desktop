import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import type { PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { workSessionFolders, Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import { CloseGuardsContext, type CloseGuards } from "./close-guards.js";
import { FilesView } from "./FilesView.js";
import { FilesReadingProvider, type FilesReading } from "./reading/files-reading.js";

export interface FilesRuntime {
	readonly queries: QueryClient;
	readonly guards: CloseGuards;
	/** Focus over rendered Markdown, when kilo.shell offers take-overs. */
	readonly reading?: FilesReading;
}

/**
 * A Files pane: an explorer of the session's folders, or one file of them.
 * The folders are the session's workspace's, its worktree standing in for
 * the primary; a session without a workspace has none.
 */
export function createFilesPane(reading: FilesReading | undefined) {
	return function ReadingFilesPane(props: PaneProps) {
		return (
			<FilesReadingProvider
				reading={reading}
				workSessionId={props.workSessionId}
				paneId={props.pane.id}
			>
				<FilesPane {...props} />
			</FilesReadingProvider>
		);
	};
}

export function FilesPane({ workSessionId, pane, workspaceId, directory }: PaneProps) {
	const workspaceFolders = useDomainObjectState(
		Workspaces,
		(state: DomainObjectState<typeof Workspaces>) =>
			state.workspaces.find((workspace) => workspace.id === workspaceId)?.folders,
	);
	const folders =
		workspaceId && workspaceFolders
			? workSessionFolders(
					workspaceFolders.map(({ path, isPrimary }) => ({ path, isPrimary })),
					directory,
				)
			: [];
	return (
		<FilesView key={pane.id} workSessionId={workSessionId} pane={pane} workspaceFolders={folders} />
	);
}

/** Gives a component the window's kilo.files query cache and close guards. */
export function withFilesRuntime<P extends object>(
	runtime: FilesRuntime,
	Component: ComponentType<P>,
): ComponentType<P> {
	return (props: P) => (
		<FilesRuntimeBoundary runtime={runtime} component={Component} componentProps={props} />
	);
}

function FilesRuntimeBoundary<P extends object>({
	runtime,
	component: Component,
	componentProps,
}: {
	readonly runtime: FilesRuntime;
	readonly component: ComponentType<P>;
	readonly componentProps: P;
}) {
	return (
		<QueryClientProvider client={runtime.queries}>
			<CloseGuardsContext.Provider value={runtime.guards}>
				<Component {...componentProps} />
			</CloseGuardsContext.Provider>
		</QueryClientProvider>
	);
}
