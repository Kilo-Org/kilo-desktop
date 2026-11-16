import { useMemo, type ReactNode } from "react";

import { compactPath } from "./compact-path";
import { useShowWorkspaceDetails } from "./workspace-details-preference";

import { KernelDialogs } from "@kilo-desktop/kernel";
import {
	useContextKey,
	useDomainObject,
	useDomainObjectState,
	useKernel,
} from "@kilo-desktop/kernel/web";
import {
	WorkspacePickerSourceProvider,
	type WorkspacePickerSource,
} from "@kilo-desktop/ui/components/workspace-picker";

import {
	ADD_WORKSPACE_COMMAND,
	DELETE_WORKSPACE_COMMAND,
	EDIT_WORKSPACE_COMMAND,
	OPEN_FOLDER_COMMAND,
	Workspaces,
	type Workspace,
	type WorkspacesState,
} from "../../contracts";

const selectState = (state: WorkspacesState) => state;

/**
 * The workspace pickers' source: the workspaces domain object, with the
 * workspace dialogs opened through their commands. Without the domain
 * object the pickers show no workspaces and offer nothing.
 */
export function useWorkspaceSource(): WorkspacePickerSource {
	const kernel = useKernel();
	const workspaces = useDomainObject(Workspaces);
	const state = useDomainObjectState(Workspaces, selectState);
	const desktop = useContextKey("kernel/desktop");
	const dialogs = useDomainObject(KernelDialogs);
	const canOpenFolder = desktop && dialogs !== null;
	const showDetails = useShowWorkspaceDetails();

	return useMemo(() => {
		const run = (command: string, args?: unknown) =>
			void kernel.commands.execute(command, args).catch(() => undefined);
		const unavailable = new Set(state?.unavailableFolderIds ?? []);
		const list = state?.workspaces ?? [];
		return {
			workspaces: list.map((workspace) => ({
				...workspace,
				detail: showDetails ? folderDetail(workspace) : undefined,
			})),
			activeWorkspaceId: state?.activeId ?? null,
			setActiveWorkspaceId: (id) =>
				void workspaces?.methods.setActive({ id }).catch(() => undefined),
			isLoading: false,
			isUnavailable: workspaces === null,
			hasUnavailableFolders: (id) =>
				list.find((workspace) => workspace.id === id)?.folders.some((f) => unavailable.has(f.id)) ??
				false,
			openCreate: () => run(ADD_WORKSPACE_COMMAND),
			...(canOpenFolder ? { openFolder: () => run(OPEN_FOLDER_COMMAND) } : {}),
			openEdit: (workspace) => run(EDIT_WORKSPACE_COMMAND, { workspaceId: workspace.id }),
			openDelete: (workspace) => run(DELETE_WORKSPACE_COMMAND, { workspaceId: workspace.id }),
		} satisfies WorkspacePickerSource;
	}, [kernel, state, workspaces, canOpenFolder, showDetails]);
}

/** The primary folder's path, shortened, or how many folders a multi-folder workspace has. */
function folderDetail(workspace: Workspace): string | undefined {
	if (workspace.folders.length > 1) return `${workspace.folders.length} folders`;
	const path = workspace.folders[0]?.path;
	return path === undefined ? undefined : compactPath(path);
}

export function WorkspaceSourceProvider({ children }: { readonly children: ReactNode }) {
	return (
		<WorkspacePickerSourceProvider value={useWorkspaceSource()}>
			{children}
		</WorkspacePickerSourceProvider>
	);
}
