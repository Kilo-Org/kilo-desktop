import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { terminalProfileSchema, terminalSettingsSchema } from "./profiles";
import { MAX_TERMINAL_READ_LINES, terminalReadoutSchema } from "./session";

export * from "./frame";
export * from "./profiles";
export * from "./session";

/**
 * kilo.terminal's public surface: terminal panes (a shell per pane, run in
 * main), the `terminalFocused` key, and the terminals of a work session for
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
 * pane's work session: origin's panes keep the chat id their history was saved under.
 */
export const TERMINAL_SESSION_METADATA_KEY = "terminalSessionId";

export const DEFAULT_TERMINAL_READ_LINES = 200;

/** kilo.terminal's commands, by key (origin's ids, so saved keybindings keep working). */
export const TERMINAL_COMMANDS = {
	open: "kilo.terminal/open",
	new: "kilo.terminal/new",
	clear: "kilo.terminal/clear",
} as const;

/** kilo.terminal's agent tools (origin's ids, kept for their wire names `desktop_terminal_<id>`). */
export const TERMINAL_TOOL_IDS = ["open", "list", "read"] as const;

const terminalTarget = z.object({
	/** The work session the terminal's pane is in. */
	workSessionId: z.string().min(1).max(512),
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

/**
 * The terminals open in each work session, and the shells new ones run;
 * absent where shells can't run (the browser).
 */
export const Terminals = defineDomainObject({
	id: "kilo.terminal/terminals",
	home: "main",
	description:
		"The terminals in each work session: list, read and close them; and the shell profiles new ones run.",
	state: z.object({
		/** The shells found on this machine and the person's own profiles (empty until detection settles). */
		profiles: z.array(terminalProfileSchema),
		settings: terminalSettingsSchema,
	}),
	methods: {
		/** Saves terminal settings; they apply the next time a shell starts. */
		updateSettings: method(terminalSettingsSchema.partial(), terminalSettingsSchema),
		/** Looks for installed shells again (after installing one). */
		refreshProfiles: method(z.undefined(), z.array(terminalProfileSchema)),
		/** The work session's terminal panes, in tab order. */
		list: method(
			z.object({ workSessionId: terminalTarget.shape.workSessionId }),
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

export const TERMINAL_DEFINITIONS: PluginDefinitions = { domainObjects: [Terminals] };
