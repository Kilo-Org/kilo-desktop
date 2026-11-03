import { z } from "zod";

const idSchema = z.string().trim().min(1).max(256);

export const BOARD_MAX_CARDS = 1_000;
export const BOARD_MAX_COLUMNS = 20;
export const BOARD_COLUMN_LABEL_MAX = 40;

export const columnLabelSchema = z.string().trim().min(1).max(BOARD_COLUMN_LABEL_MAX);
export const boardIdSchema = idSchema;

/** Columns in order, each with the Work Session ids placed in it, in order. */
export const boardStateSchema = z
	.object({
		columns: z
			.array(
				z.object({
					id: idSchema,
					label: columnLabelSchema,
					sessionIds: z.array(idSchema).max(BOARD_MAX_CARDS),
				}),
			)
			.min(1)
			.max(BOARD_MAX_COLUMNS),
	})
	.superRefine((state, ctx) => {
		const columnIds = state.columns.map((column) => column.id);
		if (new Set(columnIds).size !== columnIds.length) {
			ctx.addIssue({ code: "custom", message: "Column IDs must be unique." });
		}
		const sessionIds = state.columns.flatMap((column) => column.sessionIds);
		if (new Set(sessionIds).size !== sessionIds.length) {
			ctx.addIssue({ code: "custom", message: "A session can only appear once on the board." });
		}
		if (sessionIds.length > BOARD_MAX_CARDS) {
			ctx.addIssue({ code: "custom", message: "The board is full." });
		}
	});

export type BoardState = z.output<typeof boardStateSchema>;
export type BoardColumn = BoardState["columns"][number];
