import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { boardIdSchema, boardStateSchema, columnLabelSchema } from "./schemas";

export * from "./board-model";
export * from "./schemas";

/**
 * kilo.workspace-board's public surface: the workspace board, work sessions
 * organised into columns the person names. Cards are work session ids; the
 * board renders them with kilo.work-sessions' renderers.
 */
export const BOARD_PLUGIN_ID = "kilo.workspace-board";

/** The board's work sessions view (`kilo.work-sessions/work-sessions-view`), by contribution key. */
export const BOARD_VIEW = "kilo.workspace-board/board";

/** The "Clear the board?" confirmation (`kilo.shell/dialog`), by contribution key. */
export const CLEAR_BOARD_DIALOG = "kilo.workspace-board/clear-board";

/** Origin's command ids (`kernel/command`), kept so saved keybindings keep working. */
export const BOARD_COMMANDS = {
	toggle: "open",
	addColumn: "add-column",
	clear: "clear",
} as const;

/** Origin's `work-session-menu` items. */
export const BOARD_MENU_ITEM_IDS = ["add-to-board", "move-on-board", "remove-from-board"] as const;

/** Declared here (`kernel/flag`, off by default): LaunchDarkly's key. */
export const BOARD_FEATURE_FLAG = "workspace-board";
export const BOARD_TITLE = "Workspace Board";

/** Declared `kernel/telemetry-event` ids; the kernel sends origin's names. */
export const BOARD_TELEMETRY_EVENTS = {
	opened: "board-opened",
	placed: "board-session-placed",
	columnAdded: "board-column-added",
	cleared: "board-cleared",
} as const;

const position = z.number().int().min(0);

/**
 * The board, shared by every window. `revision` grows with every saved
 * change, so a window can tell when its own change has come back.
 */
export const Board = defineDomainObject({
	id: "kilo.workspace-board/board",
	home: "main",
	description: "The board's columns and the sessions placed in them.",
	state: z.object({ board: boardStateSchema, revision: z.number().int() }),
	methods: {
		/** Places a session in a column at `index` (clamped), moving it if it is on the board. */
		place: method(
			z.object({ sessionId: boardIdSchema, columnId: boardIdSchema, index: position }),
			z.number().int(),
		),
		remove: method(z.object({ sessionId: boardIdSchema }), z.number().int()),
		/** Takes every card off the board; columns stay. */
		clear: method(z.undefined(), z.number().int()),
		/** The caller picks the id so its optimistic column matches the saved one. */
		addColumn: method(
			z.object({ columnId: boardIdSchema, label: columnLabelSchema }),
			z.number().int(),
		),
		renameColumn: method(
			z.object({ columnId: boardIdSchema, label: columnLabelSchema }),
			z.number().int(),
		),
		moveColumn: method(z.object({ columnId: boardIdSchema, index: position }), z.number().int()),
		/** Moves the column's cards to its neighbour; the last column cannot be deleted. */
		deleteColumn: method(z.object({ columnId: boardIdSchema }), z.number().int()),
	},
});

export const BOARD_DEFINITIONS: PluginDefinitions = {
	domainObjects: [Board],
};
