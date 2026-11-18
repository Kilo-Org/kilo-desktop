import type { CompleteAttachment } from "@assistant-ui/react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { PromptQueues } from "../../contracts";
import type { CreatedChat } from "./chat-backend";
import { prepareQueuedPrompt, type QueuePromptOptions } from "./queued-prompt";

/*
 * A draft's first message, kept from the moment its chat is requested until
 * the thread takes it to send, so it outlives a thread that unmounts first.
 *
 * assistant-ui holds a draft's first send until the thread's chat exists,
 * then drops it if the thread's runtime was disposed meanwhile. On the New
 * Session page that is the page closing (another session opened) while the
 * work session's worktree is made: the chat was created and nothing sent.
 *
 * - The composer's last draft with something in it is noted (a send empties
 *   the composer before the chat is requested), and kept with the chat once
 *   it exists.
 * - A message the thread takes to send is its own: the take forgets the noted
 *   draft and the kept message, and a chat still being created when it
 *   happens keeps nothing. This holds whichever order assistant-ui makes
 *   them in, so the thread and main never both send a message.
 * - Detached with the message untaken (before or after the chat exists),
 *   the message is prepared here and queued in main, which sends it to the
 *   idle chat from no window at all.
 * - When that fails, what the message had becomes the work session's draft,
 *   for the chat's Agent pane to start with: its text, and the files it
 *   carried named, since a draft carries text alone.
 * - Only for threads whose unmount is final: a runtime a hidden Activity
 *   keeps still sends the message, which would then go twice.
 */

/** The message the composer is sending: its text as written and its attachments. */
export interface UnsentMessage {
	readonly text: string;
	readonly attachments: readonly CompleteAttachment[];
}

export interface FirstPromptHandoverOptions {
	readonly queue: () => DomainObjectHandle<typeof PromptQueues> | null;
	readonly prompt: () => QueuePromptOptions;
	/** Keeps the message main couldn't take as the work session's draft. */
	readonly keepDraft: (workSessionId: string, text: string) => void;
	readonly onError: (error: unknown) => void;
}

/** The message as a draft, which carries text alone: its text, and the files it can no longer carry. */
function draftText(message: UnsentMessage): string {
	const files = message.attachments.map(({ name }) => name).filter((name) => name);
	const text = message.text.trim();
	if (files.length === 0) return text;
	const note = `(Re-attach these files: ${files.join(", ")})`;
	return text ? `${text}\n\n${note}` : note;
}

export interface FirstPromptHandover {
	/** The composer's latest draft with something in it: what a send would send. */
	noteDraft(message: UnsentMessage): void;
	/** Creates the draft's chat with `create`, keeping the noted message for it. */
	createChat(create: () => Promise<CreatedChat>): Promise<CreatedChat>;
	/** The thread took a message to send itself: nothing it noted or kept is handed over. */
	taken(): void;
	/** The thread is mounted (again). */
	attach(): void;
	/** The thread is gone: a message it hasn't taken goes to main. */
	detach(): void;
}

interface Kept {
	readonly chat: CreatedChat;
	readonly message: UnsentMessage;
}

export function createFirstPromptHandover(
	options: FirstPromptHandoverOptions,
): FirstPromptHandover {
	let noted: UnsentMessage | undefined;
	let kept: Kept | undefined;
	let attached = true;
	let takes = 0;

	async function handOver(): Promise<void> {
		const current = kept;
		kept = undefined;
		if (!current) return;
		const { chat, message } = current;
		try {
			const queue = options.queue();
			if (!queue) throw new Error("The prompt couldn't be queued.");
			const prompt = await prepareQueuedPrompt(
				{
					content: message.text ? [{ type: "text", text: message.text }] : [],
					attachments: message.attachments,
				},
				chat.id,
				options.prompt(),
			);
			await queue.methods.enqueue({ chatId: chat.id, id: crypto.randomUUID(), prompt });
		} catch (error) {
			options.onError(error);
			const draft = draftText(message);
			if (chat.workSessionId && draft) options.keepDraft(chat.workSessionId, draft);
		}
	}

	return {
		noteDraft(message) {
			noted = message;
		},
		async createChat(create) {
			const message = noted;
			const takesBefore = takes;
			const chat = await create();
			if (message && takes === takesBefore) {
				kept = { chat, message };
				if (!attached) void handOver();
			}
			return chat;
		},
		taken() {
			takes += 1;
			noted = undefined;
			kept = undefined;
		},
		attach() {
			attached = true;
		},
		detach() {
			attached = false;
			void handOver();
		},
	};
}
