import { describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { PromptQueues } from "../../contracts";
import type { CreatedChat } from "./chat-backend";
import { createFirstPromptHandover, type UnsentMessage } from "./first-prompt-handover";

type Handle = DomainObjectHandle<typeof PromptQueues>;

const CHAT: CreatedChat = {
	id: "ses_a",
	directory: "/repo/.kilo/worktrees/a",
	workSessionId: "wses_a",
};

/** An attachment as a queued prompt reads it: only its name matters here. */
const file = (name: string) => ({ name }) as UnsentMessage["attachments"][number];

/** A stand-in for `kilo.chat/prompt-queues` in main, recording what is queued. */
function fakeQueue(enqueue: (input: unknown) => Promise<void> = async () => undefined) {
	const calls = vi.fn(enqueue);
	return { handle: { methods: { enqueue: calls } } as unknown as Handle, enqueue: calls };
}

function setup(
	queue: Handle | null,
	message: UnsentMessage | undefined = { text: "Fix it", attachments: [] },
) {
	const keepDraft = vi.fn<(workSessionId: string, text: string) => void>();
	const onError = vi.fn();
	const handover = createFirstPromptHandover({
		queue: () => queue,
		prompt: () => ({ getAgent: () => "code", getSystem: async () => "Work in the copy." }),
		keepDraft,
		onError,
	});
	if (message) handover.noteDraft(message);
	return { handover, keepDraft, onError };
}

/** A chat whose creation finishes when `finish` is called. */
function heldChat() {
	let finish!: () => void;
	const created = new Promise<CreatedChat>((resolve) => (finish = () => resolve(CHAT)));
	return { create: () => created, finish };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createFirstPromptHandover", () => {
	it("queues the message in main once the chat exists, when the thread went away first", async () => {
		const queue = fakeQueue();
		const { handover } = setup(queue.handle);
		const chat = heldChat();

		const creating = handover.createChat(chat.create);
		handover.detach();
		chat.finish();
		await creating;
		await flush();

		expect(queue.enqueue).toHaveBeenCalledOnce();
		expect(queue.enqueue).toHaveBeenCalledWith({
			chatId: "ses_a",
			id: expect.any(String),
			prompt: expect.objectContaining({
				text: "Fix it",
				textParts: [{ type: "text", text: "Fix it" }],
				agent: "code",
				system: "Work in the copy.",
			}),
		});
	});

	it("queues the message in main when the thread goes away before taking it", async () => {
		const queue = fakeQueue();
		const { handover } = setup(queue.handle);

		await handover.createChat(async () => CHAT);
		handover.detach();
		await flush();

		expect(queue.enqueue).toHaveBeenCalledOnce();
	});

	it("leaves the message to the thread that took it", async () => {
		const queue = fakeQueue();
		const { handover } = setup(queue.handle);

		await handover.createChat(async () => CHAT);
		handover.taken();
		handover.detach();
		await flush();

		expect(queue.enqueue).not.toHaveBeenCalled();
	});

	it("leaves the message to the thread that took it while its chat was being created", async () => {
		const queue = fakeQueue();
		const { handover } = setup(queue.handle);
		const chat = heldChat();

		const creating = handover.createChat(chat.create);
		handover.taken();
		chat.finish();
		await creating;
		handover.detach();
		await flush();

		expect(queue.enqueue).not.toHaveBeenCalled();
	});

	it("leaves the message to the thread that took it before asking for its chat", async () => {
		const queue = fakeQueue();
		const { handover } = setup(queue.handle);

		handover.taken();
		await handover.createChat(async () => CHAT);
		handover.detach();
		await flush();

		expect(queue.enqueue).not.toHaveBeenCalled();
	});

	it("holds the message while a remounted thread is still there", async () => {
		const queue = fakeQueue();
		const { handover } = setup(queue.handle);

		// A remount (StrictMode, a re-keyed parent) detaches and attaches again.
		handover.detach();
		handover.attach();
		await handover.createChat(async () => CHAT);
		await flush();
		expect(queue.enqueue).not.toHaveBeenCalled();

		handover.detach();
		await flush();
		expect(queue.enqueue).toHaveBeenCalledOnce();
	});

	it("keeps the text as the work session's draft when main can't take it", async () => {
		const queue = fakeQueue(async () => {
			throw new Error("The kernel is gone.");
		});
		const { handover, keepDraft, onError } = setup(queue.handle);

		await handover.createChat(async () => CHAT);
		handover.detach();
		await flush();

		expect(keepDraft).toHaveBeenCalledWith("wses_a", "Fix it");
		expect(onError).toHaveBeenCalledOnce();
	});

	it("names the files the draft can't carry when main can't take the message", async () => {
		const queue = fakeQueue(async () => {
			throw new Error("The kernel is gone.");
		});
		const { handover, keepDraft } = setup(queue.handle, {
			text: "Check this screenshot",
			attachments: [file("shot.png"), file("log.txt")],
		});

		await handover.createChat(async () => CHAT);
		handover.detach();
		await flush();

		expect(keepDraft).toHaveBeenCalledWith(
			"wses_a",
			"Check this screenshot\n\n(Re-attach these files: shot.png, log.txt)",
		);
	});

	it("keeps an attachment-only message as a draft naming its files", async () => {
		const queue = fakeQueue(async () => {
			throw new Error("The kernel is gone.");
		});
		const { handover, keepDraft } = setup(queue.handle, {
			text: "  ",
			attachments: [file("shot.png")],
		});

		await handover.createChat(async () => CHAT);
		handover.detach();
		await flush();

		expect(keepDraft).toHaveBeenCalledWith("wses_a", "(Re-attach these files: shot.png)");
	});

	it("keeps the text as the work session's draft without main's queue", async () => {
		const { handover, keepDraft } = setup(null);

		await handover.createChat(async () => CHAT);
		handover.detach();
		await flush();

		expect(keepDraft).toHaveBeenCalledWith("wses_a", "Fix it");
	});
});
