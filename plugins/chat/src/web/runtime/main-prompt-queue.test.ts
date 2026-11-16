import type { AppendMessage } from "@assistant-ui/react";
import { describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { ChatQueue, PromptQueues } from "../../contracts";
import { createMainPromptQueue, type MainPromptQueueOptions } from "./main-prompt-queue";

type Handle = DomainObjectHandle<typeof PromptQueues>;

const EMPTY: ChatQueue = { items: [], paused: false, editing: null, sending: false };

/** A stand-in for `kilo.chat/prompt-queues` in main: its state and recorded calls. */
function fakeQueues(initial: Record<string, ChatQueue> = {}) {
	let state = { queues: initial };
	const listeners = new Set<() => void>();
	const call = vi.fn(async (_method: string, _input: unknown): Promise<unknown> => undefined);
	const method =
		(name: string, result?: unknown) =>
		async (input: unknown): Promise<unknown> => {
			await call(name, input);
			return result;
		};
	const handle = {
		getState: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		methods: {
			enqueue: method("enqueue", { id: "q1" }),
			steer: method("steer"),
			remove: method("remove"),
			stopped: method("stopped"),
			clear: method("clear"),
			pause: method("pause"),
			resume: method("resume"),
			reorder: method("reorder"),
			beginEdit: method("beginEdit", { draft: null }),
			setEditDraft: method("setEditDraft"),
			commitEdit: method("commitEdit", true),
			cancelEdit: method("cancelEdit"),
		},
	} as unknown as Handle;
	return {
		handle,
		call,
		set(chatId: string, queue: ChatQueue) {
			state = { queues: { ...state.queues, [chatId]: queue } };
			for (const listener of listeners) listener();
		},
	};
}

function message(text: string, patch: Partial<AppendMessage> = {}): AppendMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		attachments: [],
		parentId: null,
		sourceId: null,
		runConfig: undefined,
		metadata: { custom: {} },
		createdAt: new Date(0),
		...patch,
	} as AppendMessage;
}

function setup(patch: Partial<MainPromptQueueOptions> = {}, queues = fakeQueues()) {
	const onError = vi.fn();
	const queue = createMainPromptQueue({
		queue: () => queues.handle,
		chatId: () => "ses_a",
		chatWorking: () => false,
		prompt: () => ({ getAgent: () => "code" }),
		onError,
		...patch,
	});
	const send = vi.fn(async (_message: AppendMessage) => undefined as void | "returned-to-composer");
	queue.setDriver({ send, cancel: async () => undefined });
	return { queue, queues, send, onError };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createMainPromptQueue", () => {
	it("sends straight through the runtime while nothing is in the way", async () => {
		const { queue, queues, send } = setup();

		queue.adapter.enqueue(message("Hi"));
		await flush();

		expect(send).toHaveBeenCalledOnce();
		expect(queues.call).not.toHaveBeenCalled();
	});

	it("sends a draft's first message through the runtime, which creates its chat", async () => {
		const { queue, send } = setup({ chatId: () => null, chatWorking: () => true });

		queue.adapter.steer(message("Hi", { steer: true }));
		await flush();

		expect(send).toHaveBeenCalledOnce();
	});

	it("queues in main while the chat works, prepared as the composer holds it", async () => {
		const { queue, queues, send } = setup({ chatWorking: () => true });

		queue.adapter.enqueue(message("Then add tests"));
		await flush();

		expect(send).not.toHaveBeenCalled();
		expect(queues.call).toHaveBeenCalledWith("enqueue", {
			chatId: "ses_a",
			prompt: expect.objectContaining({ text: "Then add tests", agent: "code" }),
		});
	});

	it("queues a steer and anything sent while the thread runs, which comes as a steer", async () => {
		const { queue, queues } = setup();
		queue.adapter.steer(message("Now", { steer: true }));
		queue.setRunning(true);
		queue.adapter.steer(message("Later"));
		await flush();

		expect(
			queues.call.mock.calls.map(([name, input]) => [name, (input as { steer?: boolean }).steer]),
		).toEqual([
			["enqueue", true],
			["enqueue", undefined],
		]);
	});

	it("queues a failed direct send in main, paused, and says why", async () => {
		const { queue, queues, send, onError } = setup();
		send.mockRejectedValueOnce(new Error("offline"));

		queue.adapter.enqueue(message("Hi"));
		await vi.waitFor(() =>
			expect(queues.call).toHaveBeenCalledWith(
				"enqueue",
				expect.objectContaining({ failed: true }),
			),
		);
		expect(onError).toHaveBeenCalledWith(new Error("offline"));
	});

	it("leaves a send the runtime returned to the composer alone", async () => {
		const { queue, queues, send } = setup();
		send.mockResolvedValueOnce("returned-to-composer");

		queue.adapter.enqueue(message("Hi"));
		await flush();

		expect(queues.call).not.toHaveBeenCalled();
	});

	it("says a prompt couldn't be queued without the queue", async () => {
		const { queue, onError } = setup({ queue: () => null, chatWorking: () => true });

		queue.adapter.enqueue(message("Hi"));
		await flush();

		expect(onError).toHaveBeenCalledWith(new Error("The prompt couldn't be queued."));
	});

	it("mirrors main's queue and forwards the composer's actions", async () => {
		const queues = fakeQueues();
		const { queue } = setup({}, queues);
		const listener = vi.fn();
		const stop = queue.subscribe(listener);
		const item = { id: "q1", prompt: "First", text: "First" };

		queues.set("ses_a", { ...EMPTY, items: [item], paused: true });

		expect(listener).toHaveBeenCalled();
		expect(queue.adapter.items).toEqual([
			{ id: "q1", prompt: "First", parts: [{ type: "text", text: "First" }] },
		]);
		expect(queue.getControlsState()).toEqual({ paused: true, editingId: undefined });
		expect(queue.getSnapshot()).toBeGreaterThan(0);

		queue.adapter.move("q1", { lane: "steer", insertAfter: null });
		queue.adapter.remove("q1");
		queue.adapter.__internal_notifyCancelled?.();
		queue.pause();
		queue.resume();
		queue.reorder(["q1"]);
		await flush();

		expect(queues.call.mock.calls.map(([name]) => name)).toEqual([
			"steer",
			"remove",
			"stopped",
			"pause",
			"resume",
			"reorder",
		]);
		stop();
	});

	it("reorders an item moved within the queue", async () => {
		const queues = fakeQueues({
			ses_a: {
				...EMPTY,
				items: ["q1", "q2", "q3"].map((id) => ({ id, prompt: id, text: id })),
			},
		});
		const { queue } = setup({}, queues);
		queue.subscribe(() => undefined);

		queue.adapter.move("q3", { insertAfter: null });
		queue.adapter.move("q1", { insertBefore: "q3" });
		queue.adapter.move("q2", {});
		queue.adapter.move("q1", { insertAfter: "missing" });
		await flush();

		expect(queues.call.mock.calls).toEqual([
			["reorder", { chatId: "ses_a", ids: ["q3", "q1", "q2"] }],
			["reorder", { chatId: "ses_a", ids: ["q2", "q1", "q3"] }],
			["reorder", { chatId: "ses_a", ids: ["q1", "q3", "q2"] }],
		]);
	});

	it("answers edits at once from the mirrored state", async () => {
		const queues = fakeQueues({
			ses_a: { ...EMPTY, items: [{ id: "q1", prompt: "First", text: "First" }] },
		});
		const { queue } = setup({}, queues);
		queue.subscribe(() => undefined);

		expect(queue.beginEdit("missing")).toBeUndefined();
		expect(queue.beginEdit("q1")).toBe("First");
		queue.setEditDraft("Fir");
		expect(queue.getEditDraft()).toBe("Fir");
		expect(queue.commitEdit("missing", "x")).toBe(false);
		expect(queue.commitEdit("q1", "  ")).toBe(false);
		expect(queue.commitEdit("q1", "Final")).toBe(true);
		queue.cancelEdit();
		await flush();

		expect(queues.call).toHaveBeenCalledWith("beginEdit", { chatId: "ses_a", id: "q1" });
		expect(queues.call).toHaveBeenCalledWith("setEditDraft", { chatId: "ses_a", text: "Fir" });
		expect(queues.call).toHaveBeenCalledWith("commitEdit", {
			chatId: "ses_a",
			id: "q1",
			text: { text: "Final", textParts: [{ type: "text", text: "Final" }] },
		});
		expect(queues.call).toHaveBeenCalledWith("cancelEdit", { chatId: "ses_a" });
	});

	it("reopens an edit with the draft main kept", () => {
		const queues = fakeQueues({
			ses_a: {
				...EMPTY,
				items: [{ id: "q1", prompt: "First", text: "First" }],
				editing: { id: "q1", draft: "Firstly" },
			},
		});
		const { queue } = setup({}, queues);
		queue.subscribe(() => undefined);

		expect(queue.getEditDraft()).toBe("Firstly");
		expect(queue.beginEdit("q1")).toBe("Firstly");
	});

	it("does nothing for a draft without a chat", async () => {
		const { queue, queues } = setup({ chatId: () => null });

		queue.pause();
		queue.setEditDraft("x");
		await flush();

		expect(queues.call).not.toHaveBeenCalled();
		expect(queue.adapter.items).toEqual([]);
	});
});
