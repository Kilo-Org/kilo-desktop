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
/** Closes a pane of the open work session. Args `{ paneId }`, else the active pane. */
export const CLOSE_PANE_COMMAND = "kilo.work-sessions/close-pane";

/*
 * Tab commands (the tab's right-click menu). Each acts on a pane of the open
 * work session: args `{ paneId }`, else the active pane. A command with
 * nothing to do does nothing.
 */

/** Closes the other tabs of the pane's group. */
export const CLOSE_OTHER_PANES_COMMAND = "kilo.work-sessions/close-other-panes";
/** Closes the tabs after the pane in its group. */
export const CLOSE_PANES_TO_THE_RIGHT_COMMAND = "kilo.work-sessions/close-panes-to-the-right";
/** Closes every tab of the pane's group. */
export const CLOSE_ALL_PANES_COMMAND = "kilo.work-sessions/close-all-panes";
/** Copies the absolute path of the file the pane shows. */
export const COPY_PANE_PATH_COMMAND = "kilo.work-sessions/copy-pane-path";
/** Copies the pane's file path relative to the work session folder holding it. */
export const COPY_PANE_RELATIVE_PATH_COMMAND = "kilo.work-sessions/copy-pane-relative-path";
/** Moves the pane into the group above, else into a new group above. */
export const MOVE_PANE_UP_COMMAND = "kilo.work-sessions/move-pane-up";
/** Moves the pane into the group below, else into a new group below. */
export const MOVE_PANE_DOWN_COMMAND = "kilo.work-sessions/move-pane-down";
/** Moves the pane into the column to the left, else into a new column there. */
export const MOVE_PANE_LEFT_COMMAND = "kilo.work-sessions/move-pane-left";
/** Moves the pane into the column to the right, else into a new column there. */
export const MOVE_PANE_RIGHT_COMMAND = "kilo.work-sessions/move-pane-right";
/** Pops the pane out into its own window, or brings that window forward. */
export const MOVE_PANE_TO_NEW_WINDOW_COMMAND = "kilo.work-sessions/move-pane-to-new-window";

/** Opens the workspace dialog to add a workspace. */
export const ADD_WORKSPACE_COMMAND = "kilo.work-sessions/add-workspace";
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
