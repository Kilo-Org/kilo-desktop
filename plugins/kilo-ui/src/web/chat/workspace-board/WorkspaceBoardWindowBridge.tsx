import { useEffect } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { useWorkspaceBoard } from "./WorkspaceBoardProvider.js";
import { useOpenSessionHere } from "./use-workspace-board-sessions.js";
import {
	WORKSPACE_BOARD_OPEN_SESSION_EVENT,
	parseOpenSessionRequest,
} from "./workspace-board-window.js";

/**
 * Main-window end of the popped-out board: opens the chats its cards ask for.
 * It lives apart from the board provider because it needs the chat runtime,
 * which the provider does not.
 */
export function WorkspaceBoardWindowBridge() {
	const board = useWorkspaceBoard();
	const sdk = useSdk("kilo-ui");
	const openSession = useOpenSessionHere();
	const listening = board !== null && !board.window.isDetached;

	useEffect(() => {
		if (!listening) return;
		return sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_OPEN_SESSION_EVENT}`, (payload) => {
			const request = parseOpenSessionRequest(payload);
			if (request) openSession(request.sessionId);
		});
	}, [listening, openSession, sdk]);

	return null;
}
