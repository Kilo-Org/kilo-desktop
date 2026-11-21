import type { ComponentType, ReactNode } from "react";
import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
	type CommandHandler,
} from "@kilo-desktop/kernel";

const nothing = z.undefined();

/** True in a window while a chat composer has keyboard focus. */
export const COMPOSER_FOCUSED_KEY = "kilo.chat/composerFocused";

export interface ComposerFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

/** Where a composer is: what composer actions and mentions are given. */
export interface ComposerContext {
	/**
	 * The work session (`kilo.work-sessions/work-sessions`) the composer
	 * belongs to; null on the New Session page, where the first send creates it.
	 */
	readonly workSessionId: string | null;
	/** The Kilo chat (`kilo.core/chats`) it sends to; null while it is a draft. */
	readonly chatId: string | null;
	/** Where the chat works; null when the work session has no folder yet. */
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
	/** A data URL, or a `file:` URL the server can read. */
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

// --- client-slash-command ---

/** The model a prompt from the pane would be sent with. */
export interface ClientSlashCommandModel {
	readonly providerID: string;
	readonly modelID: string;
}

/**
 * What the `/` menu passes the command it runs: the composer it was typed
 * in, with the pane's picks.
 */
export interface ClientSlashCommandContext extends ComposerContext {
	/** What the pane's next prompt would be sent with. */
	readonly selection: {
		readonly agent?: string | undefined;
		readonly model?: ClientSlashCommandModel | undefined;
		readonly variant?: string | undefined;
	};
	/** The chat is running a turn. */
	readonly running: boolean;
}

const nullableId = z.string().nullable();

export const clientSlashCommandContextSchema: z.ZodType<ClientSlashCommandContext> = z.object({
	workSessionId: nullableId,
	chatId: nullableId,
	directory: nullableId,
	workspaceId: nullableId,
	workspaceFolders: z.array(z.object({ path: z.string(), isPrimary: z.boolean() })),
	selection: z.object({
		agent: z.string().optional(),
		model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
		variant: z.string().optional(),
	}),
	running: z.boolean(),
});

/**
 * A `kernel/command` handler for a command placed in the `/` menu: `run`
 * gets the `ClientSlashCommandContext` the menu passes as the command's
 * argument. Run without one (from the palette, a key, the app menu), it
 * warns and does nothing, so declare such commands with `palette: false`
 * and no keybinding.
 */
export function slashCommandHandler(
	run: (context: ClientSlashCommandContext) => unknown,
): CommandHandler {
	return (args) => {
		const context = clientSlashCommandContextSchema.safeParse(args);
		if (!context.success) {
			console.warn(
				"[kilo.chat] A slash command was run without the composer's context; it runs from the / menu only.",
			);
			return undefined;
		}
		return run(context.data);
	};
}

/** What may follow `/`; `:` is left to the server's `name:skill` / `name:mcp` forms. */
const clientSlashName = z
	.string()
	.regex(/^[A-Za-z][\w-]*$/, "Letters, digits, `-` and `_`, starting with a letter.");

/**
 * Places a `kernel/command` in the composer's `/` menu (`/compact`): it runs
 * in the window instead of being sent to the agent, given the
 * `ClientSlashCommandContext` as its argument (implement it with
 * `slashCommandHandler`). It is listed under Actions, above the server's
 * commands, while its command is available, and hides a server command of
 * the same name; its aliases match when searching or sending but never hide
 * a server command. Prompt templates are not client commands: they are
 * server commands, added through `kilo.core/agent-extension`.
 */
export const ClientSlashCommand = defineExtensionPoint({
	id: "kilo.chat/client-slash-command",
	kind: "additive",
	description: "Places a kernel command in the composer's / menu.",
	metadata: z.object({
		/** The `kernel/command` key it runs. */
		command: z.string().min(1),
		/** Typed after `/`. */
		name: clientSlashName,
		/** Shown in the menu; the command's title when absent. */
		description: z.string().optional(),
		/** Other names it answers to (`/smol` for `/compact`). */
		aliases: z.array(clientSlashName).default([]),
	}),
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
 * - `footer`: the strip under a chat's composer in a work session (branch),
 *   from before its first message.
 * - `draft-footer`: the strip under the New Session page's composer, before
 *   there is a work session (a warning about the workspace).
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

/**
 * Props of a component that reads the action's own state with hooks and
 * returns `children(value)`, so the composer draws the control from it.
 */
export interface ComposerActionStateProps<T> {
	readonly context: ComposerContext;
	readonly children: (value: T) => ReactNode;
}

export type ComposerActionImplementation =
	| {
			readonly kind: "action";
			/** How the button looks; a plain button with the contribution's title by default. */
			readonly Button?: ComponentType<ComposerActionStateProps<ComposerActionButton>>;
			/** Runs on click; a contribution with `command` needs none. */
			readonly run?: (context: ComposerContext) => void | Promise<void>;
	  }
	| {
			readonly kind: "menu";
			readonly Menu: ComponentType<ComposerActionStateProps<ComposerActionMenu>>;
	  }
	| {
			readonly kind: "popover";
			/** How the popover's button looks; a plain button by default. */
			readonly Trigger?: ComponentType<ComposerActionStateProps<ComposerActionTrigger>>;
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
 * button and the menu; it renders the `Button` / `Menu` / `Trigger`
 * component while the action shows, which reads its own state with hooks and
 * hands the composer what to draw through `children`. Ordered by
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

// --- composer (per window) ---

export const composerStateSchema = z.object({
	/** The work session whose composer has keyboard focus in this window. */
	focusedWorkSessionId: z.string().nullable(),
});
export type ComposerState = z.output<typeof composerStateSchema>;

const workSessionTarget = z.object({
	/** The window's open work session when absent. */
	workSessionId: z.string().min(1).optional(),
});

/**
 * This window's composers. `focus` and `insert` open the work session's
 * agent pane if it isn't shown; `startChat` starts a new work session with
 * an agent pane, as the New Session page does, with the text in its
 * composer for the person to send; `prefillNewSession` suggests the New
 * Session page's first message. Unsent text lives in `kilo.chat/drafts`.
 */
export const Composer = defineDomainObject({
	id: "kilo.chat/composer",
	home: "renderer",
	description: "This window's composers: focus, insert, start a new chat.",
	state: composerStateSchema,
	methods: {
		focus: method(workSessionTarget, nothing),
		/** Adds text after what the composer holds. */
		insert: method(workSessionTarget.extend({ text: z.string() }), nothing),
		startChat: method(
			z.object({ text: z.string(), workspaceId: z.string().min(1).nullable().optional() }),
			z.object({ workSessionId: z.string() }),
		),
		/**
		 * Sets the New Session page's draft to `text` (empty clears it), only
		 * while the person hasn't typed their own: the draft is empty or still
		 * exactly `replacing`, a suggestion this caller made before. Kept for the
		 * page's composer when it isn't showing. Resolves whether it was set.
		 */
		prefillNewSession: method(
			z.object({ text: z.string(), replacing: z.string().optional() }),
			z.boolean(),
		),
	},
});
