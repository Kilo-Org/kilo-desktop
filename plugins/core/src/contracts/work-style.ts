import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

export const WORK_STYLES = ["human-in-the-loop", "autonomous"] as const;
export type WorkStyle = (typeof WORK_STYLES)[number];

/**
 * How much the agent may do without asking, written as permission rules into
 * the user's own global Kilo config (shared with the Kilo CLI and the VS Code
 * extension). `human-in-the-loop` ("Review first") asks before edits and
 * commands; `autonomous` restores what Review first replaced.
 */
export const KiloWorkStyle = defineDomainObject({
	id: "kilo.core/work-style",
	home: "main",
	description: "The work style: permission rules written to the user's global Kilo config.",
	state: z.object({
		/** The style last applied from this app; null until one is. */
		style: z.enum(WORK_STYLES).nullable(),
	}),
	methods: {
		/** Permission keys Review first would replace in the user's own config. */
		conflicts: method(z.undefined(), z.object({ keys: z.array(z.string()) })),
		apply: method(z.object({ style: z.enum(WORK_STYLES) }), z.undefined()),
	},
});
