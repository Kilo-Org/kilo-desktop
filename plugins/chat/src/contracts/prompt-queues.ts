import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";
import { modelRefSchema, promptChatInputSchema } from "@kilo-desktop/plugin-core/contracts";

const nothing = z.undefined();

/** A message part as `kilo.core/chats` `prompt` takes it: text, or a file as a data URL. */
const promptPartSchema = promptChatInputSchema.shape.parts.element;
export type PromptPart = z.output<typeof promptPartSchema>;

/** A slash command the text runs instead of being sent as a message. */
const commandSchema = z.object({ name: z.string().min(1), arguments: z.string() });

/** What a queued prompt's text became when the window that queued it prepared it. */
export const preparedTextSchema = z.object({
	/** As the person wrote it (mention chips encoded): shown in the queue and edited. */
	text: z.string(),
	/** The text parts with mentions resolved, and the files those mentions brought. */
	textParts: z.array(promptPartSchema),
	command: commandSchema.optional(),
});
export type PreparedText = z.output<typeof preparedTextSchema>;

const attachmentPreviewSchema = z.object({
	name: z.string(),
	/** A small image's data URL; larger ones show as a file icon. */
	src: z.string().optional(),
});

/**
 * A prompt ready for the chat, prepared by the window that queued it: what
 * the composer held then (agent, model, variant, system prompt, mentions,
 * slash command) is fixed, so it is sent as queued from any window, or none.
 */
export const queuedPromptSchema = preparedTextSchema.extend({
	/** The message's attachments as file parts (data URLs). */
	attachmentParts: z.array(promptPartSchema),
	attachmentPreview: attachmentPreviewSchema.optional(),
	agent: z.string().min(1).optional(),
	model: modelRefSchema.optional(),
	variant: z.string().min(1).optional(),
	system: z.string().optional(),
});
export type QueuedPrompt = z.output<typeof queuedPromptSchema>;

/** A prompt waiting in a chat's queue, as every window shows it. */
export const queueItemSchema = z.object({
	id: z.string(),
	/** One line for the queue: the text, else "Attachment" or "Message". */
	prompt: z.string(),
	/** The text as written, for an edit. */
	text: z.string(),
	attachmentPreview: attachmentPreviewSchema.optional(),
});
export type PromptQueueItem = z.output<typeof queueItemSchema>;

export const chatQueueSchema = z.object({
	/** Waiting, in the order they will be sent; the one being sent is not listed. */
	items: z.array(queueItemSchema),
	/** Nothing is sent on its own; Send now still works. */
	paused: z.boolean(),
	/** The item held back for an edit, and the edit's unsaved text. */
	editing: z.object({ id: z.string(), draft: z.string() }).nullable(),
	/**
	 * A prompt is being sent, or its turn hasn't started yet: what the person
	 * sends meanwhile is queued behind it rather than sent past it.
	 */
	sending: z.boolean(),
});
export type ChatQueue = z.output<typeof chatQueueSchema>;

const chatTarget = z.object({ chatId: z.string().min(1) });
const itemTarget = chatTarget.extend({ id: z.string().min(1) });

/**
 * Prompts the person queued while a chat was working, kept in main so they
 * outlive the pane that queued them (a session switch, a pop-out, a reload)
 * and are sent once, in order, when the chat goes idle, whichever window
 * shows it, or none. Send now stops the chat's turn and sends that prompt
 * next. `queues` lists chats with something queued, paused or being edited.
 * Only kilo.chat may queue, as queued prompts are sent for the person.
 * Looked up by chat id.
 */
export const PromptQueues = defineDomainObject({
	id: "kilo.chat/prompt-queues",
	home: "main",
	description:
		"Prompts queued while a chat works, sent in order when it goes idle, from any window.",
	state: z.object({
		/** By chat id. */
		queues: z.record(z.string(), chatQueueSchema),
	}),
	lookup: (state, chatId) => state.queues[chatId],
	methods: {
		/**
		 * Queues a prompt; sent at once when the chat is idle and the queue
		 * isn't paused. `steer` sends it now (stopping the turn); `failed` puts
		 * back a prompt the window could not send, paused rather than retried.
		 * The window picks `id`, so the prompt keeps one identity from the
		 * moment it lists it; an id already queued is ignored.
		 */
		enqueue: method(
			itemTarget.extend({
				prompt: queuedPromptSchema,
				steer: z.boolean().optional(),
				failed: z.boolean().optional(),
			}),
			nothing,
		),
		/** Send now: stops the chat's turn, then sends this prompt. */
		steer: method(itemTarget, nothing),
		remove: method(itemTarget, nothing),
		/** The person stopped the turn: what is waiting is held until they say otherwise. */
		stopped: method(chatTarget, nothing),
		/** Drops the chat's queue (a message edited or regenerated in the transcript). */
		clear: method(chatTarget, nothing),
		pause: method(chatTarget, nothing),
		resume: method(chatTarget, nothing),
		/** Reorders waiting prompts; unknown ids are ignored. */
		reorder: method(chatTarget.extend({ ids: z.array(z.string()) }), nothing),
		/** Holds the queue for an edit; resolves the edit's text (null when it can't be edited). */
		beginEdit: method(itemTarget, z.object({ draft: z.string().nullable() })),
		/** Keeps the open edit's text so it survives the editor closing, in any window. */
		setEditDraft: method(chatTarget.extend({ text: z.string() }), nothing),
		/** Replaces the prompt's text; false when the edit isn't open or the prompt would be empty. */
		commitEdit: method(itemTarget.extend({ text: preparedTextSchema }), z.boolean()),
		cancelEdit: method(chatTarget, nothing),
	},
});

/** The queue line for a prompt. */
export function queuePreview(prompt: Pick<QueuedPrompt, "text" | "attachmentParts">): string {
	const text = prompt.text.trim();
	if (text) return text;
	return prompt.attachmentParts.length > 0 ? "Attachment" : "Message";
}
