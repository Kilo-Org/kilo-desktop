import { useAui } from "@assistant-ui/react";
import { useEffect, useMemo, useRef } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import { useSessionActivityStore } from "../activity/SessionActivityProvider.js";
import { useWorkspaceBoard, type WorkspaceBoardContextValue } from "./WorkspaceBoardProvider.js";
import { useOpenSessionHere, useWorkspaceBoardSessions } from "./use-workspace-board-sessions.js";
import {
	WORKSPACE_BOARD_CARDS_REQUEST_EVENT,
	WORKSPACE_BOARD_OPEN_SESSION_EVENT,
	answerChatActions,
	parseOpenSessionRequest,
	publishBoardCards,
} from "./workspace-board-window.js";

/**
 * Main-window end of the popped-out board (see `workspace-board-window`):
 * publishes the board's cards and opens and acts on the chats its cards ask
 * for. It lives apart from the board provider because it needs the chat
 * runtime, which the provider does not.
 */
export function WorkspaceBoardWindowBridge() {
	const board = useWorkspaceBoard();
	if (!board || board.window.isDetached) return null;
	return <MainWindowEnd board={board} />;
}

function MainWindowEnd({ board }: { board: WorkspaceBoardContextValue }) {
	const sdk = useSdk("kilo-ui");
	const aui = useAui();
	const activity = useSessionActivityStore();
	const openSession = useOpenSessionHere();
	const sessions = useWorkspaceBoardSessions();
	const cards = useMemo(
		() =>
			board.board.columns.flatMap((column) =>
				column.sessionIds.flatMap((sessionId) => sessions.get(sessionId) ?? []),
			),
		[board.board, sessions],
	);
	const sent = useRef({ cards, json: "" });
	sent.current.cards = cards;

	useEffect(
		() =>
			sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_OPEN_SESSION_EVENT}`, (payload) => {
				const request = parseOpenSessionRequest(payload);
				if (request) openSession(request.kiloSessionId);
			}),
		[openSession, sdk],
	);

	useEffect(() => answerChatActions(sdk.events, aui, activity), [activity, aui, sdk]);

	useEffect(
		() =>
			sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_CARDS_REQUEST_EVENT}`, () => {
				sent.current.json = JSON.stringify(sent.current.cards);
				publishBoardCards(sdk.events, sent.current.cards);
			}),
		[sdk],
	);

	// Activity changes with every live event, mostly for chats not on the board,
	// so only a change to the cards themselves is sent.
	useEffect(() => {
		if (!board.window.isPoppedOut) return;
		const json = JSON.stringify(cards);
		if (json === sent.current.json) return;
		sent.current.json = json;
		publishBoardCards(sdk.events, cards);
	}, [board.window.isPoppedOut, cards, sdk]);

	return null;
}
