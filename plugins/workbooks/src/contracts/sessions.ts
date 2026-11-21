import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

/**
 * Which workbook each work session is working on: at most one per session.
 * Work sessions carry no metadata of their own, so kilo.workbooks keeps this
 * itself and forgets a session's entry when the session is deleted.
 */
export const SessionWorkbooks = defineDomainObject({
	id: "kilo.workbooks/session-workbooks",
	home: "main",
	state: z.object({
		/** Workbook id by work session id. */
		bySession: z.record(z.string(), z.string()),
	}),
	methods: {
		/** Sets (or, with null, clears) a work session's active workbook. */
		setActive: method(
			z.object({ workSessionId: z.string().min(1), workbookId: z.string().min(1).nullable() }),
			z.undefined(),
		),
	},
	lookup: (state, workSessionId) => state.bySession[workSessionId],
});
