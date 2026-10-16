import type { PaneWindow } from "@kilo-desktop/feature-sdk";

import { WORKSPACE_BOARD_ROUTE_PATH, WORKSPACE_BOARD_TITLE } from "./workspace-board-constants.js";

/**
 * The board's pop-out is a pane window without a session: it belongs to the
 * plugin as a whole, so the shell keeps it visible whichever chat is active.
 */
export const WORKSPACE_BOARD_WINDOW = {
	pluginId: "kilo-ui",
	paneId: "workspace-board",
} as const satisfies Pick<PaneWindow, "pluginId" | "paneId">;

export const WORKSPACE_BOARD_WINDOW_DESCRIPTOR: PaneWindow = {
	...WORKSPACE_BOARD_WINDOW,
	title: WORKSPACE_BOARD_TITLE,
	path: WORKSPACE_BOARD_ROUTE_PATH,
};

/** Board window → main window: open this chat there. */
export const WORKSPACE_BOARD_OPEN_SESSION_EVENT = "workspace-board-open-session";
/** Board window → main window: the board is moving back, show it. */
export const WORKSPACE_BOARD_DOCKED_EVENT = "workspace-board-docked";

export function isWorkspaceBoardWindow(
	window: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">,
): boolean {
	return (
		window.pluginId === WORKSPACE_BOARD_WINDOW.pluginId &&
		window.paneId === WORKSPACE_BOARD_WINDOW.paneId &&
		window.sessionId === undefined
	);
}

/** Events cross windows, so the payload is checked rather than trusted. */
export function parseOpenSessionRequest(payload: unknown): { sessionId: string } | null {
	if (typeof payload !== "object" || payload === null || !("sessionId" in payload)) return null;
	const { sessionId } = payload;
	return typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : null;
}
