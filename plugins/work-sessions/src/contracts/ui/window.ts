import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

/** True in a window while a work session is open. */
export const WORK_SESSION_ACTIVE_KEY = "kilo.work-sessions/workSessionActive";
/** True in a window while a work sessions view fills its main area. */
export const WORK_SESSIONS_VIEW_SHOWN_KEY = "kilo.work-sessions/workSessionsViewShown";
/** True in a window while the session list is focused on one workspace. */
export const WORKSPACE_ACTIVE_KEY = "kilo.work-sessions/workspaceActive";
/**
 * True in a window while opening a pane has somewhere to go: an open work
 * session, or the New Session page, which starts a work session with it.
 */
export const PANE_TARGET_ACTIVE_KEY = "kilo.work-sessions/paneTargetActive";

/** Focus for work sessions with no workspace (workspace ids are UUIDs, so it can't collide). */
export const UNSCOPED_WORKSPACE_FOCUS = "unscoped";

export const workSessionsWindowStateSchema = z.object({
	/** A workspace id, `unscoped`, or null for every work session. */
	focus: z.string().nullable(),
	activeWorkSessionId: z.string().nullable(),
	/** The work sessions view shown in place of the open work session (its contribution key), or null. */
	view: z.string().nullable(),
	/** Work sessions views this window popped out into their own windows. */
	detachedViews: z.array(z.string()),
});
export type WorkSessionsWindowState = z.output<typeof workSessionsWindowStateSchema>;

/**
 * This window's view of the work sessions: the workspace the session list is
 * focused on, the open work session or the work sessions view shown in its
 * place, and opening panes in the open work session as a person does. Each
 * window has its own; only the main window shows work sessions.
 *
 * Moving within the home view is this object's; leaving it (Settings, a
 * deep-linked page) is kilo.shell's `Navigation`. Opening a work session or a
 * work sessions view brings the window back to the home view.
 */
export const WorkSessionsWindow = defineDomainObject({
	id: "kilo.work-sessions/window",
	home: "renderer",
	description:
		"This window's view of the work sessions: focused workspace, open work session or work sessions view, and opening panes.",
	state: workSessionsWindowStateSchema,
	methods: {
		setFocus: method(z.object({ focus: z.string().nullable() }), z.undefined()),
		/** Opens a work session, leaving any work sessions view. */
		openWorkSession: method(z.object({ workSessionId: z.string() }), z.undefined()),
		/** Back to the home view with no work session open (the New Session page). */
		closeWorkSession: method(z.undefined(), z.undefined()),
		/**
		 * Shows a work sessions view in place of the open work session, or null
		 * to go back to it; a popped-out view's window comes to the front instead.
		 */
		showView: method(z.object({ view: z.string().nullable() }), z.undefined()),
		/**
		 * Opens a pane of a kind in the open work session the way a person does
		 * from "+": shows the work session's last pane of the kind (bringing its
		 * pop-out window forward) or opens one. With no work session open,
		 * starts one from the New Session page with a pane of the kind.
		 * Plugins' "Open Files" / "Open Terminal" commands use it.
		 */
		openPane: method(z.object({ kind: z.string().min(1) }), z.undefined()),
	},
});
