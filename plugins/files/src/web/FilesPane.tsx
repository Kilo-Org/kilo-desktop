import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type ComponentType } from "react";

import type { DomainState } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import type { PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { sessionFolders, Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { CloseGuardsContext, type CloseGuards } from "./close-guards.js";
import { FilesView } from "./FilesView.js";

export interface FilesRuntime {
	readonly queries: QueryClient;
	readonly guards: CloseGuards;
}

/**
 * A Files pane: an explorer of the session's folders, or one file of them.
 * The folders are the session's workspace's, its worktree standing in for
 * the primary; a session without a workspace has none.
 */
export function FilesPane({ sessionId, pane, workspaceId, directory }: PaneProps) {
	const workspaceFolders = useDomainState(
		Workspaces,
		useCallback(
			(state: DomainState<typeof Workspaces>) =>
				state.workspaces.find((workspace) => workspace.id === workspaceId)?.folders,
			[workspaceId],
		),
	);
	const folders = useMemo(
		() =>
			workspaceId && workspaceFolders
				? sessionFolders(
						workspaceFolders.map(({ path, isPrimary }) => ({ path, isPrimary })),
						directory,
					)
				: [],
		[directory, workspaceFolders, workspaceId],
	);
	return <FilesView key={pane.id} sessionId={sessionId} pane={pane} workspaceFolders={folders} />;
}

/** Gives a component the window's kilo.files query cache and close guards. */
export function withFilesRuntime<P extends object>(
	runtime: FilesRuntime,
	Component: ComponentType<P>,
): ComponentType<P> {
	return function WithFilesRuntime(props: P) {
		return (
			<QueryClientProvider client={runtime.queries}>
				<CloseGuardsContext.Provider value={runtime.guards}>
					<Component {...props} />
				</CloseGuardsContext.Provider>
			</QueryClientProvider>
		);
	};
}
