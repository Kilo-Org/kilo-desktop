import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { boardIdSchema, boardStateSchema, columnLabelSchema } from "./schemas";

export * from "./board-model";
export * from "./schemas";

/**
 * kilo.workspace-board's public surface: the workspace board, sessions organised into
 * columns the person names. Cards are Work Session ids; the board renders
 * them with kilo.sessions' renderers.
 */
export const BOARD_PLUGIN_ID = "kilo.workspace-board";

/** The board's sessions view (kilo.workbench/sessions-view). */
export const BOARD_VIEW = "kilo.workspace-board/board";

export const BOARD_FEATURE_FLAG = "workspace-board";
export const BOARD_TITLE = "Workspace Board";

const position = z.number().int().min(0);

/**
 * The board, shared by every window. `revision` grows with every saved
 * change, so a window can tell when its own change has come back.
 */
export const Board = defineDomain({
	id: "kilo.workspace-board/board",
	home: "main",
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
	domains: [Board],
};
