import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	defineObjectType,
	implementation,
	method,
} from "@kilo-desktop/kernel";

import { modelRefSchema } from "./models";

/**
 * Chats are Kilo sessions: the ones this app created on the Kilo server (and
 * their subagent chats). Each carries the app's `kilo-desktop` stamp
 * (`chat-stamp.ts`); kilo.core owns its format but treats the work session
 * and workspace ids in it as opaque.
 */

/** One Kilo chat, resolved by `kilo.core/chats`. */
export const Chat = defineObjectType({
	id: "kilo.core/chat",
	description: "A Kilo chat (a Kilo session), keyed by its session id.",
});

export const chatStatusSchema = z.enum(["idle", "busy", "retry"]);
export type ChatStatus = z.output<typeof chatStatusSchema>;

export const chatErrorSchema = z.object({ name: z.string(), message: z.string() });
export type ChatError = z.output<typeof chatErrorSchema>;

export const chatActivitySchema = z.object({
	status: chatStatusSchema,
	/** When the current turn started (or when the app first saw it working). */
	workingSince: z.number().optional(),
	/** When the last turn the app watched finished. */
	completedAt: z.number().optional(),
	/** The last turn's failure, until the next turn starts. */
	lastError: chatErrorSchema.optional(),
	pendingPermissionIds: z.array(z.string()),
	pendingQuestionIds: z.array(z.string()),
});
export type ChatActivity = z.output<typeof chatActivitySchema>;

export const workspaceFolderSchema = z.object({ path: z.string(), isPrimary: z.boolean() });

export const chatSummarySchema = z.object({
	/** The Kilo server's session id (`ses_…`). */
	id: z.string(),
	title: z.string(),
	directory: z.string().nullable(),
	/** Set for subagent chats. */
	parentId: z.string().nullable(),
	/** From the stamp (a subagent chat has its root's). */
	workSessionId: z.string().nullable(),
	workspaceId: z.string().nullable(),
	worktreeBranch: z.string().nullable(),
	workspaceFolders: z.array(workspaceFolderSchema),
	createdAt: z.number(),
	updatedAt: z.number(),
	archivedAt: z.number().optional(),
	activity: chatActivitySchema,
});
export type ChatSummary = z.output<typeof chatSummarySchema>;

/** A model for one turn or a new chat, with its reasoning effort. */
export const chatModelSchema = modelRefSchema.extend({ variant: z.string().min(1).optional() });

export const createChatInputSchema = z.object({
	/** Where the chat works; without one it gets its own folder under the app's chats folder. */
	directory: z.string().min(1).optional(),
	/** Stamped on the chat; opaque to kilo.core. */
	workSessionId: z.string().min(1).optional(),
	workspaceId: z.string().min(1).optional(),
	workspaceFolders: z.array(workspaceFolderSchema).optional(),
	worktreeBranch: z.string().min(1).optional(),
	agent: z.string().min(1).optional(),
	model: chatModelSchema.optional(),
	title: z.string().trim().min(1).optional(),
});
export type CreateChatInput = z.input<typeof createChatInputSchema>;

/**
 * A message for a chat, ready to send: its parts (text, and files as data
 * URLs) and the options the sender chose. With `command`, Kilo runs that
 * slash command instead and `parts` is not sent.
 */
export const promptChatInputSchema = z.object({
	chatId: z.string().min(1),
	parts: z.array(
		z.discriminatedUnion("type", [
			z.object({ type: z.literal("text"), text: z.string() }),
			z.object({
				type: z.literal("file"),
				mime: z.string().min(1),
				/** A data URL, or a `file:` URL the server can read. */
				url: z.string().min(1),
				filename: z.string().optional(),
			}),
		]),
	),
	agent: z.string().min(1).optional(),
	model: chatModelSchema.optional(),
	/** Prepended to the agent's system prompt for this turn. */
	system: z.string().optional(),
	command: z.object({ name: z.string().min(1), arguments: z.string() }).optional(),
});
export type PromptChatInput = z.input<typeof promptChatInputSchema>;

/** A permission request a chat is waiting on, in Kilo v2's shape (`Permission.Request`). */
export const permissionRequestSchema = z.object({
	id: z.string(),
	chatId: z.string(),
	/**
	 * What is asked for: a tool (`shell`, `edit`, a `kilo.core/tool` by wire
	 * name), a Kilo plugin's action, or `external_directory`.
	 */
	action: z.string(),
	/** The `kilo.core/tool` contribution key when `action` names one of the app's tools. */
	toolKey: z.string().optional(),
	/** What the action applies to: a shell command, paths, an id. */
	resources: z.array(z.string()),
	/** The resources an "Always allow" answer remembers, when they differ from `resources`. */
	save: z.array(z.string()).optional(),
	/** A line the tool wrote for the person. */
	message: z.string().optional(),
	/** What the tool attached; `interactive: true` marks a request only a person may answer. */
	metadata: z.record(z.string(), z.unknown()),
});
export type PermissionRequest = z.output<typeof permissionRequestSchema>;

/** A person's answer to a permission request (`Permission.Reply`). */
export const permissionDecisionSchema = z.enum(["once", "always", "reject"]);
export type PermissionDecision = z.output<typeof permissionDecisionSchema>;

/** A Kilo permission rule (`Permission.Rule`); Kilo applies the last rule that matches. */
export const permissionRuleSchema = z.object({
	/** The action it governs, with `*` wildcards (`shell`, `external_directory`, a tool's wire name). */
	action: z.string(),
	/** What the action applies to, with `*` wildcards; a trailing ` *` also matches nothing. */
	resource: z.string(),
	effect: z.enum(["allow", "ask", "deny"]),
});
export type PermissionRule = z.output<typeof permissionRuleSchema>;

export const chatConfigContextSchema = z.object({
	/** Null before the chat exists (asked while creating it). */
	chatId: z.string().nullable(),
	directory: z.string().nullable(),
	workSessionId: z.string().nullable(),
	workspaceId: z.string().nullable(),
});
export type ChatConfigContext = z.output<typeof chatConfigContextSchema>;

export const resolvedChatConfigSchema = z.object({
	instructions: z.array(z.string()),
	/** Tool wire names the chat should not offer. */
	disableTools: z.array(z.string()),
	permissions: z.array(permissionRuleSchema),
});
export type ResolvedChatConfig = z.output<typeof resolvedChatConfigSchema>;

const nothing = z.undefined();
const chatIdInput = z.object({ id: z.string().min(1) });
const chatEvent = z.object({ chat: chatSummarySchema });
const permissionEvent = z.object({ chatId: z.string(), permissionId: z.string() });
const questionEvent = z.object({ chatId: z.string(), questionId: z.string() });

/**
 * Every chat this app created on the Kilo server and its subagent chats,
 * shared by every window. `ready` is false until the list has been read from
 * the running server (and again while it is down); per-chat events fire only
 * while ready, so read the state when `ready` turns true and follow events
 * from then on.
 */
export const Chats = defineDomainObject({
	id: "kilo.core/chats",
	home: "main",
	description: "Kilo chats (Kilo sessions): activity, prompts, permission requests and questions.",
	state: z.object({
		ready: z.boolean(),
		chats: z.record(z.string(), chatSummarySchema),
		/**
		 * Plugins whose sign-in tools the person chose to go without: their
		 * `requiresSignIn` tools are withdrawn until they sign in. In memory.
		 */
		declinedSignInTools: z.array(z.string()),
	}),
	lookup: (state, id) => state.chats[id],
	objectType: Chat,
	methods: {
		/** Creates a chat, waiting for the server, with this app's stamp and permission rules. */
		create: method(createChatInputSchema, chatSummarySchema),
		/** Rewrites the worktree branch in the chat's stamp, keeping the rest of it. */
		setWorktreeBranch: method(chatIdInput.extend({ branch: z.string().min(1) }), nothing),
		/**
		 * Forks a root chat at one of its user messages into a new chat in the
		 * same directory, carrying the messages strictly before `messageId` and
		 * the source's stamp and permission rules, plus a hidden note telling
		 * the agent it was forked (as VS Code and JetBrains do). The fork is
		 * published only once its rules are applied; a fork whose rules can't
		 * be applied is never published and is deleted, retried until the
		 * server no longer lists it. `NOT_FOUND` for an unknown chat,
		 * `VALIDATION` for a subagent's.
		 */
		fork: method(chatIdInput.extend({ messageId: z.string().min(1) }), chatSummarySchema),
		/** What `kilo.core/chat-config` contributions want for a chat. */
		chatConfig: method(chatConfigContextSchema, resolvedChatConfigSchema),
		rename: method(chatIdInput.extend({ title: z.string().trim().min(1) }), nothing),
		delete: method(chatIdInput, nothing),
		/** Sends a message, resolving once the server has it, not when the turn ends. */
		prompt: method(promptChatInputSchema, nothing),
		/** Stops the chat's current turn. */
		abort: method(chatIdInput, nothing),
		setArchived: method(chatIdInput.extend({ archived: z.boolean() }), nothing),
		/** The permission requests the chat is waiting on, read from the server. */
		permissionRequests: method(chatIdInput, z.array(permissionRequestSchema)),
		replyPermission: method(
			z.object({
				chatId: z.string().min(1),
				permissionId: z.string().min(1),
				decision: permissionDecisionSchema,
				/** Sent to the agent with a rejection. */
				message: z.string().optional(),
			}),
			nothing,
		),
		/** One answer (the chosen labels) per question asked. */
		replyQuestion: method(
			z.object({
				chatId: z.string().min(1),
				questionId: z.string().min(1),
				answers: z.array(z.array(z.string())),
			}),
			nothing,
		),
		rejectQuestion: method(
			z.object({ chatId: z.string().min(1), questionId: z.string().min(1) }),
			nothing,
		),
		/**
		 * Withdraws the sign-in tools of `pluginId` (the plugin contributing a
		 * refused tool) until the person signs in. Does nothing while signed in.
		 */
		declineSignInTools: method(z.object({ pluginId: z.string().min(1) }), nothing),
	},
	events: {
		/** A chat joined the list. */
		created: chatEvent,
		updated: z.object({ before: chatSummarySchema, after: chatSummarySchema }),
		/** The chat was deleted on the server. */
		deleted: chatEvent,
		/**
		 * Someone sent the chat a message (announced with its first text part).
		 * A fork replays its copied user messages under new ids, so a fork's
		 * earlier messages may be announced too.
		 */
		"user-message": z.object({
			chatId: z.string(),
			messageId: z.string(),
			text: z.string(),
			model: modelRefSchema.optional(),
		}),
		"turn-started": z.object({ chatId: z.string() }),
		"turn-ended": z.object({ chatId: z.string(), error: chatErrorSchema.optional() }),
		/** Live only: a root chat, its descendants and queued background reports finished working. */
		"work-completed": z.object({ chatId: z.string() }),
		"permission-requested": permissionEvent,
		"permission-resolved": permissionEvent,
		"question-requested": questionEvent,
		"question-resolved": questionEvent,
	},
});

export interface ChatConfig {
	/** Tool wire names this chat should not offer. */
	readonly disableTools?: readonly string[];
	/** Extra system instructions. */
	readonly instructions?: readonly string[];
	/**
	 * Kilo permission rules for the chat (`shell` commands that must ask,
	 * folders to allow). Applied after the workspace's folders and before the
	 * tools' ask and deny rules.
	 */
	readonly permissions?: readonly PermissionRule[];
}

/**
 * Instructions and permissions for a chat, given its id, directory and
 * stamp. `disableTools` become deny rules and `permissions` are added when a
 * chat is created; `instructions` are read through `Chats.chatConfig`. A
 * contributor that needs more about the work session looks it up itself.
 */
export const ChatConfigPoint = defineExtensionPoint({
	id: "kilo.core/chat-config",
	kind: "additive",
	description: "Instructions and permissions for a chat, given its id, directory and stamp.",
	implementation: implementation<{
		configure(context: ChatConfigContext): ChatConfig | Promise<ChatConfig>;
	}>("main"),
});
