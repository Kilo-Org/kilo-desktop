import { createContext, useContext, type ReactNode } from "react";

import type { Workspace, WorkspaceSourceView } from "../../contracts";

/** The workspace being set up, for a host's live preview (onboarding's aside). */
export interface WorkspaceDraft {
	readonly name: string;
	readonly color: string;
	/** Folder paths, primary first. */
	readonly folders: readonly string[];
}

/**
 * What a source host (the New workspace dialog, the onboarding step) lends
 * the forms inside it. A source's screens render under the contributing
 * plugin's sdk, so kilo.work-sessions' forms can't reach its domain objects,
 * host dialogs or frame themselves; the host resolves them under its own and
 * hands them down.
 */
export interface NewFolderServices {
	/** Where a new folder goes until one is chosen; null while unknown. */
	readonly defaultLocation: string | null;
	readonly canPickDirectories: boolean;
	/** Asks for a folder with the OS picker; null when cancelled. */
	pickLocation(current: string | null): Promise<string | null>;
	readonly onCreated: (workspace: Workspace) => void;
	readonly appearance: "outlined" | "filled";
	/** Where workspaces are created from, for analytics (`Workspaces.create`'s `source`). */
	readonly origin: "dialog" | "onboarding";
	/** Draws a screen in the host's frame. */
	readonly present: (view: WorkspaceSourceView) => ReactNode;
	/** Hears the form's values as they change. */
	readonly onDraft?: (draft: WorkspaceDraft) => void;
}

export const NewFolderContext = createContext<NewFolderServices | null>(null);

export function useNewFolderServices(): NewFolderServices {
	const services = useContext(NewFolderContext);
	if (!services) throw new Error("Workspace forms render only inside a workspace source host.");
	return services;
}
