/** Consumer-owned structural view of the workspaces plugin capability. */
export interface WorkspaceFolder {
	id: string;
	path: string;
	isPrimary: boolean;
	position: number;
}

export interface Workspace {
	id: string;
	name: string;
	folders: WorkspaceFolder[];
	createdAt: number;
	updatedAt: number;
}

export interface WorkspaceCapabilities extends Record<string, unknown> {
	workspaceService: {
		get(id: string): Promise<Workspace | null>;
	};
}
