import { createContext, useContext } from "react";

import type { Workspace } from "../contracts/schemas.js";

export type WorkspacesContextValue = {
	workspaces: Workspace[];
	activeWorkspaceId: string | null;
	setActiveWorkspaceId(id: string | null): void;
	isLoading: boolean;
	isUnavailable: boolean;
	openCreate(): void;
	openEdit(workspace: Workspace): void;
	openDelete(workspace: Workspace): void;
};

export const WorkspacesContext = createContext<WorkspacesContextValue | null>(null);

export function useWorkspacesFeature(): WorkspacesContextValue {
	const value = useContext(WorkspacesContext);
	if (!value) {
		throw new Error("useWorkspacesFeature must be used within WorkspacesFeatureProvider.");
	}
	return value;
}
