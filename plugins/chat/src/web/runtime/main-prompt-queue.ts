import type {
	AppendMessage,
	ExternalThreadQueueAdapter,
	QueueItemState,
} from "@assistant-ui/react";
import type {
	OpenCodeMessageQueueController,
	OpenCodeMessageQueueDriver,
} from "@kilo-desktop/react-opencode";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { ChatQueue, PromptQueues, PromptQueueItem } from "../../contracts";
import {
	prepareQueuedPrompt,
	prepareText,
	queueItemOf,
	type QueuePromptOptions,
} from "./queued-prompt";

type PromptQueueHandle = DomainObjectHandle<typeof PromptQueues>;

export interface MainPromptQueueOptions {
	readonly queue: () => PromptQueueHandle | null;
	/** The chat the thread shows; null while a draft has none. */
	readonly chatId: () => string | null;
	/** Whether kilo.core reports the chat working (the queue in main waits on the same). */
	readonly chatWorking: () => boolean;
	readonly prompt: () => QueuePromptOptions;
	/** The thread handed a message over to be sent or queued. */
	readonly onTaken?: () => void;
	readonly onError: (error: unknown) => void;
}

const NO_QUEUE: ChatQueue = { items: [], paused: false, editing: null, sending: false };

type QueueAction = (queue: PromptQueueHandle, chatId: string) => Promise<unknown>;

/** A prompt on its way to main's queue, listed under the id main will know it by. */
interface Handover {
	readonly item: PromptQueueItem;
	/** What the person did to its row before main had it, done once main has. */
	readonly held: QueueAction[];
	/** Deleted before it reached main, so it isn't queued at all. */
	removed: boolean;
	/** The state this window had when main answered. */
	answered?: ChatQueue;
}

/**
 * A thread's view of its chat's queue in main (`kilo.chat/prompt-queue`), in
 * the shape react-opencode's runtime drives (`messageQueue.create`). Main
 * owns what waits and sends it; this only forwards the composer's actions
 * and mirrors main's state, so the queue outlives the runtime: a session
 * switch, a pop-out or a reload shows it again, from any window.
 *
 * - A message sent while nothing is in the way (the thread idle, the chat
 *   idle in kilo.core, nothing queued or being sent) goes straight through
 *   the runtime (`driver`), as any send: shown at once, a draft's first send
 *   creates its chat, and a failure returns it to the composer. A send that
 *   fails otherwise is queued in main, paused.
 * - Anything else is prepared here (what the composer chose, mentions,
 *   slash command, files) and queued in main, which sends it when the chat
 *   is idle. Send now stops the turn there.
 * - A prompt is listed the moment it is handed over, under the id it is
 *   queued with in main, while it is prepared and until main's state lists
 *   it, so it never leaves the composer without showing in the queue. What
 *   the person does to its row meanwhile waits for main to have it; a delete
 *   before then keeps it from being queued at all.
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
	let handovers: Handover[] = [];
	let version = 0;
	let localDraft: { id: string; text: string } | undefined;

	// assistant-ui routes every send made during a run through `steer`; only a
	// message marked `steer` asks to stop the turn. Main has one lane: moving an
	// item into the steer lane sends it now, any other move reorders.
	const adapter: OpenCodeMessageQueueController["adapter"] = {
		items: [],
		steerItems: [],
		enqueue: (message) => void enqueue(message, false),
		steer: (message) => void enqueue(message, message.steer === true),
		move: (id, placement) => {
			if (placement.lane === "steer") {
				forward(id, (queue, chatId) => queue.methods.steer({ chatId, id }));
				return;
			}
			const ids = reorderedIds(
				view.items.map((item) => item.id),
				id,
				placement,
			);
			if (ids) call((queue, chatId) => queue.methods.reorder({ chatId, ids }));
		},
		edit: (id, message) => {
			const text = message.content
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("");
			forward(id, async (queue, chatId) => {
				const prepared = await prepareText(text.trim(), options.prompt());
				await queue.methods.commitEdit({ chatId, id, text: prepared });
			});
		},
		remove: (id) => {
			const removal: QueueAction = (queue, chatId) => queue.methods.remove({ chatId, id });
			const handover = waitingHandover(id);
			if (!handover) {
				call(removal);
				return;
			}
			handover.removed = true;
			handover.held.push(removal);
			dropHandover(handover);
		},
		__internal_notifyCancelled: () => call((queue, chatId) => queue.methods.stopped({ chatId })),
	};

	function readView(): ChatQueue {
		const chatId = options.chatId();
		return (chatId && options.queue()?.getState().queues[chatId]) || NO_QUEUE;
	}

	function refresh(): void {
		const next = readView();
		const waiting = handovers.filter((handover) => !landed(handover, next));
		if (next === view && waiting.length === handovers.length) return;
		view = next;
		handovers = waiting;
		if (localDraft && view.editing?.id !== localDraft.id) localDraft = undefined;
		publish();
	}

	function publish(): void {
		const listed = new Set(view.items.map((item) => item.id));
		const unlisted = handovers.filter((handover) => !listed.has(handover.item.id));
		adapter.items = [...view.items, ...unlisted.map((handover) => handover.item)].map(toItemState);
		version += 1;
		for (const listener of listeners) listener();
	}

	/**
	 * Main's state may reach this window before or after its answer: either it
	 * lists the prompt, or the next state after the answer has dealt with it.
	 */
	function landed({ item, answered }: Handover, current: ChatQueue): boolean {
		if (!answered) return false;
		return current !== answered || current.items.some(({ id }) => id === item.id);
	}

	function handOver(message: AppendMessage): Handover {
		const handover: Handover = {
			item: { id: crypto.randomUUID(), ...queueItemOf(message) },
			held: [],
			removed: false,
		};
		handovers = [...handovers, handover];
		publish();
		return handover;
	}

	function dropHandover(handover: Handover): void {
		handovers = handovers.filter((candidate) => candidate !== handover);
		publish();
	}

	/** The listed prompt `id` while main doesn't have it yet. */
	function waitingHandover(id: string): Handover | undefined {
		return handovers.find((handover) => handover.item.id === id && !handover.answered);
	}

	function call(action: QueueAction): void {
		const queue = options.queue();
		const chatId = options.chatId();
		if (!queue || !chatId) return;
		action(queue, chatId).catch(options.onError);
	}

	/** Runs an action on prompt `id` now, or once main has it. */
	function forward(id: string, action: QueueAction): void {
		const handover = waitingHandover(id);
		if (handover) handover.held.push(action);
		else call(action);
	}

	function sendsDirectly(steer: boolean): boolean {
		if (!driver) return false;
		if (!options.chatId()) return true;
		if (steer || running || options.chatWorking()) return false;
		return view.items.length === 0 && handovers.length === 0 && !view.sending && !view.editing;
	}

	async function enqueue(message: AppendMessage, steer: boolean): Promise<void> {
		options.onTaken?.();
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
		const handover = handOver(message);
		try {
			// The guard reads `removed` after the await on purpose: the person can remove the item
			// while its prompt is being prepared.
			// react-doctor-disable-next-line react-doctor/async-defer-await
			const prompt = await prepareQueuedPrompt(message, chatId, options.prompt());
			if (handover.removed) return;
			await queue.methods.enqueue({
				chatId,
				id: handover.item.id,
				prompt,
				...(flags.steer ? { steer: true } : {}),
				...(flags.failed ? { failed: true } : {}),
			});
			handover.answered = readView();
			for (const action of handover.held) call(action);
			refresh();
		} catch (error) {
			dropHandover(handover);
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
			const item = view.items.find((candidate) => candidate.id === id) ?? waitingHandover(id)?.item;
			if (!item) return undefined;
			const draft = view.editing?.id === id ? view.editing.draft : item.text;
			localDraft = { id, text: draft };
			forward(id, (queue, chatId) => queue.methods.beginEdit({ chatId, id }));
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

/** `ids` with `id` moved to `placement`, or null when it isn't queued. */
function reorderedIds(
	ids: readonly string[],
	id: string,
	{ insertAfter, insertBefore }: Parameters<ExternalThreadQueueAdapter["move"]>[1],
): string[] | null {
	const rest = ids.filter((candidate) => candidate !== id);
	const anchor = insertAfter ?? insertBefore;
	if (rest.length === ids.length || (anchor != null && !rest.includes(anchor))) return null;
	const index =
		insertAfter !== undefined
			? insertAfter === null
				? 0
				: rest.indexOf(insertAfter) + 1
			: insertBefore !== undefined && insertBefore !== null
				? rest.indexOf(insertBefore)
				: rest.length;
	return [...rest.slice(0, index), id, ...rest.slice(index)];
}

function toItemState(item: PromptQueueItem): QueueItemState {
	return {
		id: item.id,
		prompt: item.prompt,
		parts: [{ type: "text", text: item.prompt }],
		...(item.attachmentPreview ? { attachmentPreview: item.attachmentPreview } : {}),
	} as QueueItemState;
}
