/**
 * Commands and dialogs of kilo.work-sessions other plugins run or open by
 * key. Every command runs in the window that invokes it, except where noted.
 */

/** Opens the New Session page (no work session open). */
export const NEW_WORK_SESSION_COMMAND = "kilo.work-sessions/new-work-session";
/** Starts an empty work session from the New Session page. */
export const NEW_EMPTY_WORK_SESSION_COMMAND = "kilo.work-sessions/new-empty-work-session";
/** Searches work sessions and workspaces. */
export const SEARCH_WORK_SESSIONS_COMMAND = "kilo.work-sessions/search-work-sessions";
/** Runs in the main window: opens a work session there (from any window). Args `{ workSessionId }`. */
export const OPEN_WORK_SESSION_COMMAND = "kilo.work-sessions/open-work-session";
/** Runs in the main window: shows a work sessions view there (from any window). Args `{ view }`. */
export const SHOW_WORK_SESSIONS_VIEW_COMMAND = "kilo.work-sessions/show-work-sessions-view";
/** Opens the "+" picker of the open work session. */
export const NEW_PANE_COMMAND = "kilo.work-sessions/new-pane";
/** Closes the open work session's active pane. */
export const CLOSE_PANE_COMMAND = "kilo.work-sessions/close-pane";

/** Opens the workspace dialog to add a workspace. */
export const ADD_WORKSPACE_COMMAND = "kilo.work-sessions/add-workspace";
/** Picks a folder and makes its workspace active, creating one named after the folder if needed. */
export const OPEN_FOLDER_COMMAND = "kilo.work-sessions/open-folder";
/** Opens the workspace dialog's list of workspaces. */
export const MANAGE_WORKSPACES_COMMAND = "kilo.work-sessions/manage-workspaces";
/** Opens the workspace dialog to edit a workspace. Args `{ workspaceId }`. */
export const EDIT_WORKSPACE_COMMAND = "kilo.work-sessions/edit-workspace";
/** Asks to delete a workspace. Args `{ workspaceId }`. */
export const DELETE_WORKSPACE_COMMAND = "kilo.work-sessions/delete-workspace";

/** The `kilo.shell/dialog` contribution holding the workspace dialogs. */
export const WORKSPACE_DIALOGS_KEY = "kilo.work-sessions/workspace-dialogs";

/** What the workspace dialogs are opened with (`Navigation.openDialog`'s `input`). */
export type WorkspaceDialogInput =
	| { readonly mode: "create" }
	| { readonly mode: "manage" }
	| { readonly mode: "edit"; readonly workspaceId: string }
	| { readonly mode: "delete"; readonly workspaceId: string };
