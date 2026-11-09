import { useMemo, type ReactNode } from "react";

import { useDomain, useDomainState, useKernel } from "@kilo-desktop/kernel/web";
import { Workspaces, type WorkspacesState } from "@kilo-desktop/plugin-workspaces/contracts";
import {
	WorkspacePickerSourceProvider,
	type WorkspacePickerSource,
} from "@kilo-desktop/ui/components/workspace-picker";

const selectState = (state: WorkspacesState) => state;

/**
 * The workspace picker's source in kilo.workbench: kilo.workspaces' domain
 * object, with its dialogs opened through its commands. Without kilo.workspaces
 * the pickers show no workspaces and offer nothing.
 */
export function useWorkspaceSource(): WorkspacePickerSource {
	const kernel = useKernel();
	const workspaces = useDomain(Workspaces);
	const state = useDomainState(Workspaces, selectState);

	return useMemo(() => {
		const run = (command: string, args?: unknown) =>
			void kernel.commands.execute(`kilo.workspaces/${command}`, args).catch(() => undefined);
		const unavailable = new Set(state?.unavailableFolderIds ?? []);
		const list = state?.workspaces ?? [];
		return {
			workspaces: list,
			activeWorkspaceId: state?.activeId ?? null,
			setActiveWorkspaceId: (id) =>
				void workspaces?.methods.setActive({ id }).catch(() => undefined),
			isLoading: false,
			isUnavailable: workspaces === null,
			hasUnavailableFolders: (id) =>
				list.find((workspace) => workspace.id === id)?.folders.some((f) => unavailable.has(f.id)) ??
				false,
			openCreate: () => run("add"),
			openEdit: (workspace) => run("edit", { workspaceId: workspace.id }),
			openDelete: (workspace) => run("delete", { workspaceId: workspace.id }),
		} satisfies WorkspacePickerSource;
	}, [kernel, state, workspaces]);
}

export function WorkspaceSourceProvider({ children }: { readonly children: ReactNode }) {
	return (
		<WorkspacePickerSourceProvider value={useWorkspaceSource()}>
			{children}
		</WorkspacePickerSourceProvider>
	);
}
