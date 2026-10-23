import type { useAui } from "@assistant-ui/react";
import { z } from "zod";

import type { PaneWindow, SDK } from "@kilo-desktop/feature-sdk";

import {
	isOrphanedWorktreeSession,
	type SessionActivity,
} from "../activity/session-activity-logic.js";
import {
	whenSessionsRefreshed,
	type SessionActivityStore,
} from "../activity/session-activity-store.js";
import { WORKSPACE_BOARD_ROUTE_PATH, WORKSPACE_BOARD_TITLE } from "./workspace-board-constants.js";
import type { BoardSession } from "./workspace-board-sessions.js";

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

/*
 * The popped-out board is a view of the main window's chats. Each window has
 * its own thread list and activity store, and only the main window's follow
 * every chat (it creates them, and it is the one the sidebar shows), so the
 * main window publishes the board's cards and runs the actions taken on them;
 * the board window only renders and asks, over these `kilo-ui` events.
 */

/** Board window → main window: open this chat there. */
export const WORKSPACE_BOARD_OPEN_SESSION_EVENT = "workspace-board-open-session";
/** Board window → main window: the board is moving back, show it. */
export const WORKSPACE_BOARD_DOCKED_EVENT = "workspace-board-docked";
/** Board window → main window: send the cards (it also sends them on every change). */
export const WORKSPACE_BOARD_CARDS_REQUEST_EVENT = "workspace-board-cards-request";
/** Main window → board window: the placed chats, as `{ cards }`. */
export const WORKSPACE_BOARD_CARDS_EVENT = "workspace-board-cards";
/** Board window → main window: run this action on a chat. */
export const WORKSPACE_BOARD_CHAT_ACTION_EVENT = "workspace-board-chat-action";
/** Main window → board window: how that action went, matched by `requestId`. */
export const WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT = "workspace-board-chat-action-result";

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
export function parseOpenSessionRequest(payload: unknown): { kiloSessionId: string } | null {
	if (typeof payload !== "object" || payload === null || !("kiloSessionId" in payload)) return null;
	const { kiloSessionId } = payload;
	return typeof kiloSessionId === "string" && kiloSessionId.length > 0 ? { kiloSessionId } : null;
}

/** Long enough for a slow server delete; short enough not to strand an edit. */
const RESULT_TIMEOUT_MS = 30_000;

type Events = SDK["events"];
type Aui = ReturnType<typeof useAui>;

// The payloads come from this plugin's main window; checking their outline
// guards the board against a stale or foreign sender without restating every field.
const cardsSchema = z.object({
	cards: z.array(
		z.object({
			sessionId: z.string().min(1),
			kiloSessionId: z.string().min(1),
			threadId: z.string(),
			title: z.string(),
			archived: z.boolean(),
			activity: z
				.custom<SessionActivity>((value) => typeof value === "object" && value !== null)
				.optional(),
			rowState: z.enum(["approval", "input", "working", "done"]).nullable(),
		}),
	),
});

const chatActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("rename"),
		kiloSessionId: z.string().min(1),
		title: z.string().min(1),
	}),
	z.object({ action: z.literal("archive"), kiloSessionId: z.string().min(1) }),
	z.object({ action: z.literal("delete"), kiloSessionId: z.string().min(1) }),
	// Whether deleting the chat should offer to remove its worktree, which only
	// the main window's activity knows: the board window's stops at its opening.
	z.object({ action: z.literal("check-orphaned-worktree"), kiloSessionId: z.string().min(1) }),
]);

export type ChatAction = z.output<typeof chatActionSchema>;

const chatActionRequestSchema = z.intersection(
	chatActionSchema,
	z.object({ requestId: z.string().min(1) }),
);

const chatActionResultSchema = z.object({
	requestId: z.string().min(1),
	error: z.string().optional(),
	orphanedWorktree: z.boolean().optional(),
});

export type ChatActionResult = { orphanedWorktree?: boolean };

/** Main window: sends the cards. */
export function publishBoardCards(events: Events, cards: readonly BoardSession[]): void {
	events.emit(WORKSPACE_BOARD_CARDS_EVENT, { cards });
}

/** Board window: follows the main window's cards, asking for them once to start. */
export function followBoardCards(
	events: Events,
	onCards: (cards: readonly BoardSession[]) => void,
): () => void {
	const stop = events.on(`kilo-ui.${WORKSPACE_BOARD_CARDS_EVENT}`, (payload) => {
		const parsed = cardsSchema.safeParse(payload);
		if (parsed.success) onCards(parsed.data.cards as BoardSession[]);
	});
	events.emit(WORKSPACE_BOARD_CARDS_REQUEST_EVENT, undefined);
	return stop;
}

/** Board window: asks the main window to run the action and settles with its result. */
export function requestMainWindowChatAction(
	events: Events,
	action: ChatAction,
): Promise<ChatActionResult> {
	const requestId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stop();
			reject(new Error("The main window did not respond."));
		}, RESULT_TIMEOUT_MS);
		const stop = events.on(`kilo-ui.${WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT}`, (payload) => {
			const result = chatActionResultSchema.safeParse(payload);
			if (!result.success || result.data.requestId !== requestId) return;
			clearTimeout(timer);
			stop();
			const { error, orphanedWorktree } = result.data;
			if (error !== undefined) reject(new Error(error));
			else resolve(orphanedWorktree === undefined ? {} : { orphanedWorktree });
		});
		events.emit(WORKSPACE_BOARD_CHAT_ACTION_EVENT, { ...action, requestId });
	});
}

/** Main window: runs requested actions on its own thread list and activity, and reports back. */
export function answerChatActions(
	events: Events,
	aui: Aui,
	activity: SessionActivityStore,
): () => void {
	return events.on(`kilo-ui.${WORKSPACE_BOARD_CHAT_ACTION_EVENT}`, (payload) => {
		const request = chatActionRequestSchema.safeParse(payload);
		if (!request.success) return;
		const { requestId } = request.data;
		runChatAction(aui, activity, request.data).then(
			(result) => events.emit(WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT, { requestId, ...result }),
			(error: unknown) =>
				events.emit(WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT, {
					requestId,
					error: error instanceof Error ? error.message : "The action failed.",
				}),
		);
	});
}

async function runChatAction(
	aui: Aui,
	activity: SessionActivityStore,
	action: ChatAction,
): Promise<ChatActionResult> {
	if (action.action === "check-orphaned-worktree") {
		// As the sidebar's delete does: an unsettled refresh may not have stamped the worktree yet.
		await whenSessionsRefreshed(activity);
		return {
			orphanedWorktree: isOrphanedWorktreeSession(
				activity.getState().sessions,
				action.kiloSessionId,
			),
		};
	}
	const known = aui.threads
		.getState()
		.threadItems.find((item) => item.remoteId === action.kiloSessionId);
	if (!known) throw new Error("The session is not loaded in the main window.");
	const item = aui.threads.item({ id: known.id });
	// The item's methods are typed void but return the thread list's promises.
	if (action.action === "rename") await item.rename(action.title);
	else if (action.action === "archive") await item.archive();
	else await item.delete();
	return {};
}
