import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

const idSchema = z.string().trim().min(1).max(256);

const WORKSPACE_BOARD_MAX_CARDS = 1_000;
export const WORKSPACE_BOARD_MAX_COLUMNS = 20;
export const WORKSPACE_BOARD_COLUMN_LABEL_MAX = 40;

const columnLabelSchema = z.string().trim().min(1).max(WORKSPACE_BOARD_COLUMN_LABEL_MAX);

export const workspaceBoardStateSchema = z
	.object({
		columns: z
			.array(
				z.object({
					id: idSchema,
					label: columnLabelSchema,
					sessionIds: z.array(idSchema).max(WORKSPACE_BOARD_MAX_CARDS),
				}),
			)
			.min(1)
			.max(WORKSPACE_BOARD_MAX_COLUMNS),
	})
	.superRefine((state, ctx) => {
		const columnIds = state.columns.map((column) => column.id);
		if (new Set(columnIds).size !== columnIds.length) {
			ctx.addIssue({ code: "custom", message: "Column IDs must be unique." });
		}
		const sessionIds = state.columns.flatMap((column) => column.sessionIds);
		if (new Set(sessionIds).size !== sessionIds.length) {
			ctx.addIssue({ code: "custom", message: "A chat can only appear once on the board." });
		}
		if (sessionIds.length > WORKSPACE_BOARD_MAX_CARDS) {
			ctx.addIssue({ code: "custom", message: "The board is full." });
		}
	});

export type WorkspaceBoardState = z.infer<typeof workspaceBoardStateSchema>;
export type WorkspaceBoardColumn = WorkspaceBoardState["columns"][number];

export const workspaceBoardContract = defineContract({
	"workspaceBoard.get": defineMethod(z.undefined(), workspaceBoardStateSchema),
	"workspaceBoard.place": defineMethod(
		z.object({ sessionId: idSchema, columnId: idSchema, index: z.number().int().min(0) }),
		workspaceBoardStateSchema,
	),
	"workspaceBoard.remove": defineMethod(
		z.object({ sessionId: idSchema }),
		workspaceBoardStateSchema,
	),
	/** Takes every card off the board; columns stay. */
	"workspaceBoard.clear": defineMethod(z.undefined(), workspaceBoardStateSchema),
	/** The renderer picks the id so its optimistic column matches the saved one. */
	"workspaceBoard.addColumn": defineMethod(
		z.object({ columnId: idSchema, label: columnLabelSchema }),
		workspaceBoardStateSchema,
	),
	"workspaceBoard.renameColumn": defineMethod(
		z.object({ columnId: idSchema, label: columnLabelSchema }),
		workspaceBoardStateSchema,
	),
	"workspaceBoard.moveColumn": defineMethod(
		z.object({ columnId: idSchema, index: z.number().int().min(0) }),
		workspaceBoardStateSchema,
	),
	"workspaceBoard.deleteColumn": defineMethod(
		z.object({ columnId: idSchema }),
		workspaceBoardStateSchema,
	),
});
export type WorkspaceBoardService = InferContract<typeof workspaceBoardContract>;
