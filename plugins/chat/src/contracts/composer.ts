import type { ComponentType, ReactNode } from "react";
import { z } from "zod";

import { defineDomain, defineExtensionPoint, implementation, method } from "@kilo-desktop/kernel";

const nothing = z.undefined();

export interface ComposerFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

/** Where a composer is: what composer actions and mentions are given. */
export interface ComposerContext {
	/**
	 * The Work Session (`kilo.sessions/work-session`) the composer belongs to; null
	 * on the New Session page, where the first send creates it.
	 */
	readonly sessionId: string | null;
	/** The Kilo chat it sends to; null while it is a draft. */
	readonly chatId: string | null;
	/** Where the chat works; null when the session has no folder yet. */
	readonly directory: string | null;
	readonly workspaceId: string | null;
	readonly workspaceFolders: readonly ComposerFolder[];
}

export type IconComponent = ComponentType<{ readonly className?: string }>;

// --- composer-mention ---

/** One thing a mention source offers while the person types after its trigger. */
export interface MentionItem {
	/** Stable within the source; handed back to `resolve`. */
	readonly id: string;
	/** Shown in the list and on the chip. */
	readonly label: string;
	/** A second, muted line in the list (a path, a description). */
	readonly detail?: string;
	readonly icon?: IconComponent;
}

export interface MentionSearchContext extends Omit<ComposerContext, "chatId"> {
	/** Aborted when the query changes or the list closes. */
	readonly signal: AbortSignal;
}

/** A file handed to the agent with the message, as a prompt file part. */
export interface MentionFile {
	readonly url: string;
	readonly mime: string;
	readonly filename?: string;
}

/**
 * What a mention becomes in the message: `text` in its place (the label when
 * absent) and/or files sent with it.
 */
export interface ResolvedMention {
	readonly text?: string;
	readonly files?: readonly MentionFile[];
}

export interface ComposerMentionImplementation {
	search(query: string, context: MentionSearchContext): Promise<readonly MentionItem[]>;
	/** Turns a chosen item into agent context when the message is sent. */
	resolve(
		item: Pick<MentionItem, "id" | "label">,
		context: MentionSearchContext,
	): Promise<ResolvedMention> | ResolvedMention;
	/** The chip's icon (and the list's, for items without their own). */
	readonly icon?: IconComponent;
}

/**
 * A source of `@`-style mentions: typing its trigger in the composer lists
 * what `search` finds; a chosen item shows as a chip and is resolved into the
 * message when it is sent.
 */
export const ComposerMention = defineExtensionPoint({
	id: "kilo.chat/composer-mention",
	kind: "additive",
	description: "Mentions typed after a trigger character, resolved into agent context.",
	metadata: z.object({
		/** One character, not `/` (slash commands). */
		trigger: z
			.string()
			.length(1)
			.refine((char) => char !== "/" && char.trim() === char, "Not a usable trigger."),
		/** What the list is ("Files"); its empty and loading labels say it. */
		title: z.string().min(1),
	}),
	implementation: implementation<ComposerMentionImplementation>("renderer"),
});

// --- composer-action ---

export const composerActionSlotSchema = z.enum([
	"toolbar",
	"toolbar-end",
	"footer",
	"draft-footer",
]);
/**
 * - `toolbar`: the composer's left controls (attach, pickers).
 * - `toolbar-end`: before send (approvals).
 * - `footer`: the strip under a chat's composer (branch).
 * - `draft-footer`: the strip under a draft's composer (workspace, branch).
 */
export type ComposerActionSlot = z.output<typeof composerActionSlotSchema>;

/** How an action's button looks right now; every field is optional. */
export interface ComposerActionTrigger {
	/** Inside the button, after the icon. */
	readonly label?: ReactNode;
	readonly icon?: IconComponent;
	/** Accessible name; the contribution's title by default. */
	readonly ariaLabel?: string;
	readonly tooltip?: string;
	readonly disabled?: boolean;
	readonly busy?: boolean;
	/** Tints the button (an agent's colour). */
	readonly color?: string;
	/** Leaves the button out. */
	readonly hidden?: boolean;
}

export interface ComposerActionButton extends ComposerActionTrigger {
	/** Runs on click, ahead of the implementation's `run` and the contribution's `command`. */
	readonly run?: () => void;
}

export interface ComposerActionMenuItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: IconComponent;
	/** A colour for the icon (an agent's). */
	readonly color?: string;
	readonly disabled?: boolean;
}

export interface ComposerActionMenu extends ComposerActionTrigger {
	readonly items: readonly ComposerActionMenuItem[];
	/** The checked item, for a pick-one menu. */
	readonly value?: string;
	readonly select: (id: string) => void;
	readonly align?: "start" | "end";
	/** Shown instead of items while they load. */
	readonly loading?: boolean;
}

export interface ComposerActionPopoverProps extends ComposerContext {
	/** Whether the popover is open; the content stays mounted while it is closed. */
	readonly open: boolean;
	readonly close: () => void;
}

export type ComposerActionImplementation =
	| {
			readonly kind: "action";
			readonly useButton?: (context: ComposerContext) => ComposerActionButton;
			/** Runs on click; a contribution with `command` needs none. */
			readonly run?: (context: ComposerContext) => void | Promise<void>;
	  }
	| {
			readonly kind: "menu";
			readonly useMenu: (context: ComposerContext) => ComposerActionMenu;
	  }
	| {
			readonly kind: "popover";
			readonly useTrigger?: (context: ComposerContext) => ComposerActionTrigger;
			/**
			 * The popup, inside the composer's popover root: render a
			 * `PopoverContent` (or a component built on it).
			 */
			readonly Content: ComponentType<ComposerActionPopoverProps>;
	  }
	| {
			readonly kind: "view";
			/** Drawn as it is, in the slot (a read-only label, or its own controls). */
			readonly Component: ComponentType<ComposerContext>;
	  };

/**
 * A control in the composer: a button (`action`), a pick-from-list menu
 * (`menu`), a button opening a popover (`popover`) or the contribution's own
 * component (`view`, e.g. git's branch label). The composer draws the
 * button and the menu; `useButton` / `useMenu` / `useTrigger` run as hooks
 * while it shows, so contributions read their own state. Ordered by
 * priority, highest first; kilo.chat's own controls come through it too.
 */
export const ComposerAction = defineExtensionPoint({
	id: "kilo.chat/composer-action",
	kind: "additive",
	description: "A button, menu or popover in the composer.",
	metadata: z.object({
		slot: composerActionSlotSchema.default("toolbar"),
		kind: z.enum(["action", "menu", "popover", "view"]),
		/** Accessible name and tooltip. */
		title: z.string().min(1),
		/** For `action`: the command run on click (`kernel/command` key). */
		command: z.string().optional(),
	}),
	implementation: implementation<ComposerActionImplementation>("renderer", { required: false }),
});

// --- drafts (main) ---

const draftsSchema = z.record(z.string(), z.object({ text: z.string() }));

/**
 * Unsent composer text by Work Session, in main so it goes wherever the
 * session's agent pane is shown (a pop-out, another window, a reload) and a
 * new chat can be prefilled before its pane exists. Kept until the app quits
 * or the session is removed; only kilo.chat writes it.
 */
export const ComposerDrafts = defineDomain({
	id: "kilo.chat/drafts",
	home: "main",
	state: z.object({ drafts: draftsSchema }),
	methods: {
		/** Empty text drops the session's draft. */
		set: method(z.object({ sessionId: z.string().min(1), text: z.string() }), nothing),
	},
});

// --- composer (per window) ---

export const composerStateSchema = z.object({
	/** The session whose composer has keyboard focus in this window. */
	focusedSessionId: z.string().nullable(),
});
export type ComposerState = z.output<typeof composerStateSchema>;

const sessionTarget = z.object({
	/** The window's open session when absent. */
	sessionId: z.string().min(1).optional(),
});

/**
 * This window's composers. `focus` and `insert` open the session's agent pane
 * if it isn't shown; `startNewChat` starts a new Agent session, as the
 * launcher does, with the text in its composer for the person to send. Unsent
 * text lives in `kilo.chat/drafts`.
 */
export const Composer = defineDomain({
	id: "kilo.chat/composer",
	home: "renderer",
	state: composerStateSchema,
	methods: {
		focus: method(sessionTarget, nothing),
		/** Adds text after what the composer holds. */
		insert: method(sessionTarget.extend({ text: z.string() }), nothing),
		startNewChat: method(
			z.object({ text: z.string(), workspaceId: z.string().min(1).nullable().optional() }),
			z.object({ sessionId: z.string() }),
		),
	},
});
