import { z } from "zod";

import { defineDomain, defineExtensionPoint, implementation, method } from "@kilo-desktop/kernel";

/**
 * Chat Sessions: the Kilo server's chats this app created (and their subagent
 * chats), with what other plugins and windows need without a transcript —
 * the list, live activity and pending prompts — and the actions on them.
 */

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
	/** Stamped when the chat was created (a subagent chat has its root's). */
	workspaceId: z.string().nullable(),
	worktreeBranch: z.string().nullable(),
	workspaceFolders: z.array(workspaceFolderSchema),
	/** The Work Session the chat was created for, when it was given one. */
	workSessionId: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	archivedAt: z.number().optional(),
	activity: chatActivitySchema,
});
export type ChatSummary = z.output<typeof chatSummarySchema>;

export const createChatInputSchema = z.object({
	/** Where the chat works; without one it gets its own folder under the app's chats folder. */
	directory: z.string().min(1).optional(),
	/** Links the chat to this Work Session (stamped on the chat). */
	sessionId: z.string().min(1).optional(),
	workspaceId: z.string().min(1).optional(),
	workspaceFolders: z.array(workspaceFolderSchema).optional(),
	worktreeBranch: z.string().min(1).optional(),
	agent: z.string().min(1).optional(),
	model: z
		.object({
			providerID: z.string().min(1),
			id: z.string().min(1),
			variant: z.string().optional(),
		})
		.optional(),
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
	parts: z.array(z.record(z.string(), z.unknown())),
	agent: z.string().min(1).optional(),
	model: z.object({ providerID: z.string().min(1), modelID: z.string().min(1) }).optional(),
	variant: z.string().min(1).optional(),
	/** Prepended to the agent's system prompt for this turn. */
	system: z.string().optional(),
	command: z.object({ name: z.string().min(1), arguments: z.string() }).optional(),
});
export type PromptChatInput = z.input<typeof promptChatInputSchema>;

/** A permission request a chat is waiting on, as the server describes it. */
export const permissionRequestSchema = z.object({
	id: z.string(),
	chatId: z.string(),
	/** What is asked for: a tool (`bash`, `edit`, `desktop_terminal_open`) or `external_directory`. */
	permission: z.string(),
	patterns: z.array(z.string()),
	/** The server's flags (`sandboxEscalation`, `configProtected`, `skillShell`…). */
	metadata: z.record(z.string(), z.unknown()),
});
export type PermissionRequest = z.output<typeof permissionRequestSchema>;

export const sessionConfigInputSchema = z.object({
	sessionId: z.string().nullable(),
	workspaceId: z.string().nullable(),
	directory: z.string().nullable(),
});

export const resolvedSessionConfigSchema = z.object({
	instructions: z.array(z.string()),
	disableTools: z.array(z.string()),
	permissions: z.array(
		z.object({
			permission: z.string(),
			pattern: z.string(),
			action: z.enum(["allow", "ask", "deny"]),
		}),
	),
});
export type ResolvedSessionConfig = z.output<typeof resolvedSessionConfigSchema>;

export const generateInputSchema = z.object({
	/** The folder the agent reads the request in (its project). */
	directory: z.string().min(1),
	/** Names the throwaway chat while it exists. */
	title: z.string().trim().min(1).max(256),
	system: z.string().max(20_000),
	prompt: z.string().min(1).max(4_000_000),
	/** The JSON schema of the answer. */
	schema: z.record(z.string(), z.unknown()),
	/** The server's default model when absent. */
	model: z
		.object({
			providerID: z.string().min(1),
			modelID: z.string().min(1),
			variant: z.string().min(1).optional(),
		})
		.optional(),
});
export type GenerateInput = z.input<typeof generateInputSchema>;

const branchNameModelSchema = z.object({
	providerID: z.string().min(1),
	modelID: z.string().min(1),
});

export const generateBranchNameInputSchema = z.object({
	chatId: z.string().min(1),
	/** The prompt that should shape the name; empty to name from the conversation so far. */
	prompt: z.string().max(100_000),
	/** The server's default model when absent. */
	model: branchNameModelSchema.optional(),
});
export type GenerateBranchNameInput = z.input<typeof generateBranchNameInputSchema>;

const nothing = z.undefined();
const chatIdInput = z.object({ id: z.string().min(1) });
const chatEvent = z.object({ chat: chatSummarySchema });
const permissionEvent = z.object({ chatId: z.string(), permissionId: z.string() });
const questionEvent = z.object({ chatId: z.string(), questionId: z.string() });

/**
 * Every chat this app created on the Kilo server and its subagent chats,
 * shared by every window. `ready` is false until the list has been read from
 * the running server (it goes false again while the server is down); the
 * per-chat events below fire only while ready, so a consumer reads the state
 * when `ready` turns true and follows events from then on.
 */
export const Conversations = defineDomain({
	id: "kilo.agent/conversation",
	home: "main",
	state: z.object({
		ready: z.boolean(),
		chats: z.record(z.string(), chatSummarySchema),
	}),
	lookup: (state, id) => state.chats[id] ?? null,
	methods: {
		/** Creates a chat, waiting for the server, with this app's stamp and permission rules. */
		create: method(createChatInputSchema, chatSummarySchema),
		/**
		 * One structured answer from the agent: a throwaway chat that may use
		 * no tool but the structured-output sink (the prompt may carry
		 * untrusted content), is never listed, and is deleted afterwards.
		 * Resolves the answer object (shaped by `schema`, not checked against it).
		 */
		generate: method(generateInputSchema, z.record(z.string(), z.unknown())),
		/**
		 * A task-focused branch name for the chat's conversation, from the Kilo
		 * server; null while the task isn't clear yet.
		 */
		generateBranchName: method(
			generateBranchNameInputSchema,
			z.object({ branch: z.string().nullable() }),
		),
		/** Rewrites the worktree branch in the chat's stamp, keeping the rest of its metadata. */
		setWorktreeBranch: method(chatIdInput.extend({ branch: z.string().min(1) }), nothing),
		/** What `kilo.agent/session-config` contributions want for a session's chats. */
		sessionConfig: method(sessionConfigInputSchema, resolvedSessionConfigSchema),
		rename: method(chatIdInput.extend({ title: z.string().trim().min(1) }), nothing),
		delete: method(chatIdInput, nothing),
		/**
		 * Sends a message to the chat (kilo.chat's alone), resolving once the
		 * server has it, not when the turn ends. A slash command is started and
		 * left to run.
		 */
		prompt: method(promptChatInputSchema, nothing),
		/** Stops the chat's current turn. */
		abort: method(chatIdInput, nothing),
		setArchived: method(chatIdInput.extend({ archived: z.boolean() }), nothing),
		/** The permission requests the chat is waiting on, read from the server. */
		permissionRequests: method(chatIdInput, z.array(permissionRequestSchema)),
		/** Answering prompts (this and the two below) is kilo.chat's alone. */
		replyPermission: method(
			z.object({
				chatId: z.string().min(1),
				permissionId: z.string().min(1),
				reply: z.enum(["once", "always", "reject"]),
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
	},
	events: {
		/** A chat joined the list. */
		created: chatEvent,
		updated: z.object({ before: chatSummarySchema, after: chatSummarySchema }),
		/** The chat was deleted on the server. */
		deleted: chatEvent,
		/** Someone sent the chat a message (announced with its first text part). */
		"user-message": z.object({
			chatId: z.string(),
			messageId: z.string(),
			text: z.string(),
			model: branchNameModelSchema.optional(),
		}),
		"turn-started": z.object({ chatId: z.string() }),
		"turn-ended": z.object({ chatId: z.string(), error: chatErrorSchema.optional() }),
		"permission-requested": permissionEvent,
		"permission-resolved": permissionEvent,
		"question-requested": questionEvent,
		"question-resolved": questionEvent,
	},
});

export interface ChatOwnerImplementation {
	/** The Work Session holding the chat; null when it holds none. */
	sessionOf(chatId: string): string | null;
}

/**
 * Says which Work Session holds a chat (kilo.sessions), so kilo.agent can tell
 * tools where they were called from without depending on its consumers.
 */
export const ChatOwner = defineExtensionPoint({
	id: "kilo.agent/chat-owner",
	kind: "additive",
	description: "Says which Work Session holds a Kilo chat.",
	implementation: implementation<ChatOwnerImplementation>("main"),
});
