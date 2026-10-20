import { z } from "zod";

import { defineEvent } from "../contract.js";

/** One app-wide shortcut: a canonical chord (see `serializeChord`) bound to a command id. */
export const shortcutBinding = z.object({
	chord: z.string().min(1).max(64),
	commandId: z.string().min(1).max(256),
	repeatable: z.boolean().optional(),
});

export const shortcutsSyncPayload = z.object({
	bindings: z.array(shortcutBinding).max(512),
	/** A shortcut recorder has focus: menu accelerators must not fire (e.g. ⌘Q quitting). */
	recording: z.boolean().optional(),
});

export const shortcutTriggeredPayload = z.object({
	commandId: z.string().min(1).max(256),
	/** The pressed chord, so a focus-scoped command can take it over from the owner. */
	chord: z.string().min(1).max(64),
});

/** Renderer → main: replace the sender's table. A message, so main knows the sender. */
export const shortcutsMessages = {
	"shortcuts:sync": defineEvent(shortcutsSyncPayload),
} as const;

export const shortcutsEvents = {
	"shortcuts:triggered": defineEvent(shortcutTriggeredPayload),
} as const;

export type ShortcutBinding = z.output<typeof shortcutBinding>;
