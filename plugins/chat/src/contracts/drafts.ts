import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

export const workSessionDraftsSchema = z.object({
	/** Text for the work session's next agent pane to start with (a new chat prefilled before its pane exists). */
	text: z.string(),
	/** Each agent pane's unsent text, by pane id. */
	panes: z.record(z.string(), z.string()).optional(),
});
export type WorkSessionDrafts = z.output<typeof workSessionDraftsSchema>;

export const draftsStateSchema = z.object({
	/** By work session id. */
	drafts: z.record(z.string(), workSessionDraftsSchema),
});
export type DraftsState = z.output<typeof draftsStateSchema>;

/**
 * Unsent composer text by work session and agent pane, in main so it goes
 * wherever the pane is shown (a pop-out, another window, a reload). A work
 * session's own text prefills a new chat before its pane exists; the first
 * agent pane to show takes it. Kept until the app quits or the work session
 * is removed; only kilo.chat writes it. Looked up by work session id.
 */
export const Drafts = defineDomainObject({
	id: "kilo.chat/drafts",
	home: "main",
	description: "Unsent composer text by work session, for every window.",
	state: draftsStateSchema,
	lookup: (state, workSessionId) => state.drafts[workSessionId],
	methods: {
		/** The pane's text, or without a pane the work session's; empty text drops it. */
		setText: method(
			z.object({
				workSessionId: z.string().min(1),
				paneId: z.string().min(1).optional(),
				text: z.string(),
			}),
			z.undefined(),
		),
	},
});
