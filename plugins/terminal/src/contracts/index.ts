import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { MAX_TERMINAL_READ_LINES, terminalReadoutSchema } from "./session";

export * from "./frame";
export * from "./session";

/**
 * kilo.terminal's public surface: terminal panes (a shell per pane, run in
 * main), the `terminalFocused` key, and the terminals of a session for
 * whoever needs to see what they print (agent tools).
 */
export const TERMINAL_PLUGIN_ID = "kilo.terminal";

/** The terminal pane kind's contribution key. */
export const TERMINAL_PANE_KIND = "kilo.terminal/terminal";

/** True in a window while a terminal has keyboard focus. */
export const TERMINAL_FOCUSED_KEY = "kilo.terminal/terminalFocused";

/** The port a terminal frame streams its shell over. */
export const TERMINAL_PORT = "session";

/**
 * Pane metadata naming the shell session a pane belongs to, when it isn't the
 * pane's session: origin's panes keep the chat id their history was saved under.
 */
export const TERMINAL_SESSION_METADATA_KEY = "terminalSessionId";

export const DEFAULT_TERMINAL_READ_LINES = 200;

const terminalTarget = z.object({
	/** The Work Session the terminal's pane is in. */
	sessionId: z.string().min(1).max(512),
	/** The terminal's pane id. */
	terminalId: z.string().min(1).max(512),
});

export const terminalSummarySchema = z.object({
	terminalId: z.string(),
	title: z.string(),
	/** A shell is running in it now. */
	running: z.boolean(),
});
export type TerminalSummary = z.output<typeof terminalSummarySchema>;

export const terminalExitedSchema = terminalTarget.extend({
	exitCode: z.number().int().nullable(),
	exitSignal: z.number().int().nullable(),
});
export type TerminalExited = z.output<typeof terminalExitedSchema>;

/** The terminals open in each session; absent where shells can't run (the browser). */
export const Terminals = defineDomain({
	id: "kilo.terminal/terminals",
	home: "main",
	state: z.object({}),
	methods: {
		/** The session's terminal panes, in tab order. */
		list: method(
			z.object({ sessionId: terminalTarget.shape.sessionId }),
			z.array(terminalSummarySchema),
		),
		/** A plain-text tail of what a terminal printed; null when it has printed nothing it kept. */
		read: method(
			terminalTarget.extend({
				lines: z.number().int().min(0).max(MAX_TERMINAL_READ_LINES).optional(),
			}),
			terminalReadoutSchema.nullable(),
		),
		/** Stops a terminal's shell; its pane stays open. */
		close: method(terminalTarget.extend({ deleteHistory: z.boolean().optional() }), z.undefined()),
	},
	events: {
		/** A terminal's shell exited (its pane closes). */
		exited: terminalExitedSchema,
	},
});

export const TERMINAL_DEFINITIONS: PluginDefinitions = { domains: [Terminals] };
