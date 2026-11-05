import type { AppendMessage, QueueItemState } from "@assistant-ui/react";
import type {
	OpenCodeMessageQueueController,
	OpenCodeMessageQueueDriver,
} from "@assistant-ui/react-opencode";

import type { DomainHandle } from "@kilo-desktop/kernel";

import type { ChatQueue, PromptQueue, PromptQueueItem } from "../../contracts";
import { prepareQueuedPrompt, prepareText, type QueuePromptOptions } from "./queued-prompt";

type PromptQueueHandle = DomainHandle<typeof PromptQueue>;

export interface MainPromptQueueOptions {
	readonly queue: () => PromptQueueHandle | null;
	/** The chat the thread shows; null while a draft has none. */
	readonly chatId: () => string | null;
	/** Whether kilo.agent reports the chat working (the queue in main waits on the same). */
	readonly chatWorking: () => boolean;
	readonly prompt: () => QueuePromptOptions;
	readonly onError: (error: unknown) => void;
}

const NO_QUEUE: ChatQueue = { items: [], paused: false, editing: null, sending: false };

/**
 * A thread's view of its chat's queue in main (`kilo.chat/prompt-queue`), in
 * the shape react-opencode's runtime drives (`messageQueue.create`). Main
 * owns what waits and sends it; this only forwards the composer's actions
 * and mirrors main's state, so the queue outlives the runtime: a session
 * switch, a pop-out or a reload shows it again, from any window.
 *
 * - A message sent while nothing is in the way (the thread idle, the chat
 *   idle in kilo.agent, nothing queued or being sent) goes straight through
 *   the runtime (`driver`), as any send: shown at once, a draft's first send
 *   creates its chat, and a failure returns it to the composer. A send that
 *   fails otherwise is queued in main, paused.
 * - Anything else is prepared here (what the composer chose, mentions,
 *   slash command, files) and queued in main, which sends it when the chat
 *   is idle. Send now stops the turn there.
 * - Edits answer at once from the mirrored state (the runtime asks
 *   synchronously); main holds the queue while one is open.
 */
export function createMainPromptQueue(
	options: MainPromptQueueOptions,
): OpenCodeMessageQueueController {
	const listeners = new Set<() => void>();
	let driver: OpenCodeMessageQueueDriver | undefined;
	let running = false;
	let view = NO_QUEUE;
	let version = 0;
	let localDraft: { id: string; text: string } | undefined;

	const adapter: OpenCodeMessageQueueController["adapter"] = {
		items: [],
		enqueue: (message, { steer }) => void enqueue(message, steer),
		steer: (id) => call((queue, chatId) => queue.methods.steer({ chatId, id })),
		remove: (id) => call((queue, chatId) => queue.methods.remove({ chatId, id })),
		clear: (reason) =>
			call((queue, chatId) =>
				reason === "cancel-run"
					? queue.methods.stopped({ chatId })
					: queue.methods.clear({ chatId }),
			),
	};

	function readView(): ChatQueue {
		const chatId = options.chatId();
		return (chatId && options.queue()?.getState().queues[chatId]) || NO_QUEUE;
	}

	function refresh(): void {
		const next = readView();
		if (next === view) return;
		view = next;
		if (localDraft && view.editing?.id !== localDraft.id) localDraft = undefined;
		adapter.items = view.items.map(toItemState);
		version += 1;
		for (const listener of listeners) listener();
	}

	function call(action: (queue: PromptQueueHandle, chatId: string) => Promise<unknown>): void {
		const queue = options.queue();
		const chatId = options.chatId();
		if (!queue || !chatId) return;
		action(queue, chatId).catch(options.onError);
	}

	function sendsDirectly(steer: boolean): boolean {
		if (!driver) return false;
		if (!options.chatId()) return true;
		if (steer || running || options.chatWorking()) return false;
		return view.items.length === 0 && !view.sending && !view.editing;
	}

	async function enqueue(message: AppendMessage, steer: boolean): Promise<void> {
		if (message.startRun === false || sendsDirectly(steer)) {
			await sendDirectly(message);
			return;
		}
		await queueInMain(message, { steer });
	}

	async function sendDirectly(message: AppendMessage): Promise<void> {
		try {
			const outcome = await driver!.send(message);
			if (outcome === "returned-to-composer") return;
		} catch (error) {
			options.onError(error);
			await queueInMain(message, { failed: true });
		}
	}

	async function queueInMain(
		message: AppendMessage,
		flags: { steer?: boolean; failed?: boolean },
	): Promise<void> {
		const queue = options.queue();
		const chatId = options.chatId();
		if (!queue || !chatId) {
			options.onError(new Error("The prompt couldn't be queued."));
			return;
		}
		try {
			const prompt = await prepareQueuedPrompt(message, chatId, options.prompt());
			await queue.methods.enqueue({
				chatId,
				prompt,
				...(flags.steer ? { steer: true } : {}),
				...(flags.failed ? { failed: true } : {}),
			});
		} catch (error) {
			options.onError(error);
		}
	}

	return {
		adapter,
		subscribe(listener) {
			if (listeners.size === 0) refresh();
			listeners.add(listener);
			const stop = options.queue()?.subscribe(refresh);
			return () => {
				listeners.delete(listener);
				stop?.();
			};
		},
		getSnapshot: () => {
			refresh();
			return version;
		},
		getControlsState: () => ({ paused: view.paused, editingId: view.editing?.id }),
		setOptions: () => undefined,
		setDriver(next) {
			driver = next;
		},
		setRunning(next) {
			running = next;
		},
		pause: () => call((queue, chatId) => queue.methods.pause({ chatId })),
		resume: () => call((queue, chatId) => queue.methods.resume({ chatId })),
		reorder: (ids) => call((queue, chatId) => queue.methods.reorder({ chatId, ids: [...ids] })),
		beginEdit(id) {
			const item = view.items.find((candidate) => candidate.id === id);
			if (!item) return undefined;
			const draft = view.editing?.id === id ? view.editing.draft : item.text;
			localDraft = { id, text: draft };
			call((queue, chatId) => queue.methods.beginEdit({ chatId, id }));
			return draft;
		},
		setEditDraft(text) {
			const id = localDraft?.id ?? view.editing?.id;
			if (!id) return;
			localDraft = { id, text };
			call((queue, chatId) => queue.methods.setEditDraft({ chatId, text }));
		},
		getEditDraft: () => localDraft?.text ?? view.editing?.draft,
		commitEdit(id, text) {
			const item = view.items.find((candidate) => candidate.id === id);
			if (!item || (!text.trim() && !item.attachmentPreview)) return false;
			localDraft = undefined;
			call(async (queue, chatId) => {
				const prepared = await prepareText(text.trim(), options.prompt());
				await queue.methods.commitEdit({ chatId, id, text: prepared });
			});
			return true;
		},
		cancelEdit() {
			localDraft = undefined;
			call((queue, chatId) => queue.methods.cancelEdit({ chatId }));
		},
	};
}

function toItemState(item: PromptQueueItem): QueueItemState {
	return {
		id: item.id,
		prompt: item.prompt,
		...(item.attachmentPreview ? { attachmentPreview: item.attachmentPreview } : {}),
	} as QueueItemState;
}
