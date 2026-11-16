import {
	KernelError,
	type DomainObjectCaller,
	type DomainObjectHandle,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Chats, type ChatStatus } from "@kilo-desktop/plugin-core/contracts";

import { CHAT_PLUGIN_ID, PromptQueues, type ChatQueue, type QueuedPrompt } from "../../contracts";
import { ChatPromptQueue } from "./chat-prompt-queue";

type ChatsHandle = DomainObjectHandle<typeof Chats>;

const isWorking = (status: ChatStatus) => status === "busy" || status === "retry";

/**
 * The `prompt-queues` domain object: every chat's queued prompts, in main so
 * they outlive the pane that queued them and are sent once, from here,
 * through kilo.core's `Chats.prompt` (see `ChatPromptQueue`). Each queue
 * follows its chat's status in `Chats` state and kilo.core's turn events.
 * Windows prepare a prompt when it is queued (what the composer chose,
 * mentions resolved, slash command found), so nothing here needs a window.
 * Queues live until the app quits, or their chat is deleted.
 */
export function activatePromptQueues(sdk: PluginSdk): void {
	const queues = new Map<string, ChatPromptQueue>();
	let chats: ChatsHandle | null = null;
	let counter = 0;

	const chatOnly = (caller: DomainObjectCaller) => {
		if (caller.pluginId !== CHAT_PLUGIN_ID) {
			throw new KernelError("PERMISSION_DENIED", "Only kilo.chat can queue prompts.");
		}
	};

	function publish(): void {
		const views: Record<string, ChatQueue> = {};
		for (const [chatId, queue] of queues) {
			const view = queue.view();
			if (view) views[chatId] = view;
			else if (queue.empty) {
				queue.dispose();
				queues.delete(chatId);
			}
		}
		provider.setState({ queues: views });
	}

	function workingOf(chatId: string): boolean | null {
		const state = chats?.getState();
		const chat = state?.ready ? state.chats[chatId] : undefined;
		return chat ? isWorking(chat.activity.status) : null;
	}

	function queueOf(chatId: string): ChatPromptQueue {
		let queue = queues.get(chatId);
		if (!queue) {
			queue = new ChatPromptQueue(
				{
					send: (prompt) => send(chatId, prompt),
					abort: async () => {
						if (!chats) throw new Error("Kilo chats aren't available.");
						await chats.methods.abort({ id: chatId });
					},
					changed: () => publish(),
				},
				() => `queued-${++counter}`,
			);
			queues.set(chatId, queue);
			queue.setWorking(workingOf(chatId));
		}
		return queue;
	}

	async function send(chatId: string, prompt: QueuedPrompt): Promise<void> {
		if (!chats) throw new Error("Kilo chats aren't available.");
		const { textParts, attachmentParts, agent, model, variant, system, command } = prompt;
		await chats.methods.prompt({
			chatId,
			parts: [...textParts, ...attachmentParts],
			...(agent ? { agent } : {}),
			...(model ? { model: { ...model, ...(variant ? { variant } : {}) } } : {}),
			...(system ? { system } : {}),
			...(command ? { command } : {}),
		});
	}

	/** Runs `action` on a chat's queue for kilo.chat, creating the queue when `create`. */
	const on =
		<I extends { chatId: string }, R>(
			action: (queue: ChatPromptQueue, input: I) => R,
			fallback: R,
			create = false,
		) =>
		(input: I, caller: DomainObjectCaller): R => {
			chatOnly(caller);
			const queue = create ? queueOf(input.chatId) : queues.get(input.chatId);
			return queue ? action(queue, input) : fallback;
		};

	const provider = sdk.domainObjects.provide(PromptQueues, {
		initialState: { queues: {} },
		methods: {
			enqueue: on(
				(queue, { prompt, steer, failed }) => ({
					id: queue.enqueue(prompt, {
						...(steer ? { steer } : {}),
						...(failed ? { failed } : {}),
					}),
				}),
				{ id: "" },
				true,
			),
			steer: on((queue, { id }) => queue.steer(id), undefined),
			remove: on((queue, { id }) => queue.remove(id), undefined),
			stopped: on((queue) => queue.stopped(), undefined),
			clear: on((queue) => queue.clear(), undefined),
			pause: on((queue) => queue.pause(), undefined),
			resume: on((queue) => queue.resume(), undefined),
			reorder: on((queue, { ids }) => queue.reorder(ids), undefined),
			beginEdit: on((queue, { id }) => ({ draft: queue.beginEdit(id) }), { draft: null }),
			setEditDraft: on((queue, { text }) => queue.setEditDraft(text), undefined),
			commitEdit: on((queue, { id, text }) => queue.commitEdit(id, text), false),
			cancelEdit: on((queue) => queue.cancelEdit(), undefined),
		},
	});

	function followStatus(): void {
		for (const [chatId, queue] of queues) queue.setWorking(workingOf(chatId));
	}

	/**
	 * A turn kilo.core reports may not have shown in the status yet (one that
	 * starts and ends between two publications): seeing it working first
	 * releases a queue waiting for its prompt's turn to start.
	 */
	function turnSeen(chatId: string, ended: boolean): void {
		const queue = queues.get(chatId);
		if (!queue) return;
		queue.setWorking(true);
		if (ended) queue.setWorking(workingOf(chatId));
	}

	let stopTracking = () => {};
	sdk.domainObjects.track(Chats, {
		added: (handle) => {
			chats = handle;
			const stops = [
				handle.subscribe(followStatus),
				handle.on("turn-started", ({ chatId }) => turnSeen(chatId, false)),
				handle.on("turn-ended", ({ chatId }) => turnSeen(chatId, true)),
				handle.on("work-completed", ({ chatId }) => turnSeen(chatId, true)),
				handle.on("deleted", ({ chat }) => {
					queues.get(chat.id)?.dispose();
					if (queues.delete(chat.id)) publish();
				}),
			];
			followStatus();
			stopTracking = () => {
				for (const stop of stops) stop();
			};
		},
		removed: () => {
			stopTracking();
			chats = null;
			followStatus();
		},
	});

	sdk.onDispose(() => {
		for (const queue of queues.values()) queue.dispose();
		queues.clear();
	});
}
