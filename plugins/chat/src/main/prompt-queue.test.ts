import { describe, expect, it } from "vitest";

import type { QueuedPrompt } from "../contracts";
import { bootChatMain, chat, setStatus, settle } from "./test-helpers";

const working = (id: string) => {
	const summary = chat(id);
	return { ...summary, activity: { ...summary.activity, status: "busy" as const } };
};

function prompt(text: string, patch: Partial<QueuedPrompt> = {}): QueuedPrompt {
	return { text, textParts: [{ type: "text", text }], attachmentParts: [], ...patch };
}

async function bootBusy(options: { queueEditing?: boolean; chats?: string[] } = {}) {
	const booted = await bootChatMain({
		chats: (options.chats ?? ["ses_a"]).map(working),
		queueEditing: options.queueEditing ?? true,
	});
	const queue = booted.asChat.promptQueue;
	const enqueue = async (text: string, extra: { steer?: boolean } = {}) =>
		(await queue.methods.enqueue({ chatId: "ses_a", prompt: prompt(text), ...extra })).id;
	const sent = () => booted.fake.prompts.map((input) => (input.parts[0] as { text: string }).text);
	const items = () => queue.getState().queues.ses_a?.items.map((item) => item.text) ?? [];
	/** One turn: the server starts the prompt just sent, then finishes it. */
	const turn = async () => {
		setStatus(booted.fake, "ses_a", "busy");
		setStatus(booted.fake, "ses_a", "idle");
		await settle();
	};
	return { ...booted, queue, enqueue, sent, items, turn };
}

describe("queued prompts", () => {
	it("sends a prompt queued while the chat works once its turn ends, as the window prepared it", async () => {
		const { queue, fake } = await bootBusy();
		const attachment = { type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" };

		await queue.methods.enqueue({
			chatId: "ses_a",
			prompt: prompt("Then add tests", {
				attachmentParts: [attachment],
				attachmentPreview: { name: "shot.png", src: attachment.url },
				agent: "code",
				model: { providerID: "acme", modelID: "fast-1" },
				variant: "high",
				system: "Primary folder: /projects/app",
			}),
		});
		await settle();

		expect(fake.prompts).toEqual([]);
		expect(queue.getState().queues.ses_a).toEqual({
			items: [
				{
					id: expect.any(String),
					prompt: "Then add tests",
					text: "Then add tests",
					attachmentPreview: { name: "shot.png", src: attachment.url },
				},
			],
			paused: false,
			editing: null,
			sending: false,
		});

		setStatus(fake, "ses_a", "idle");
		await settle();

		expect(fake.prompts).toEqual([
			{
				chatId: "ses_a",
				parts: [{ type: "text", text: "Then add tests" }, attachment],
				agent: "code",
				model: { providerID: "acme", modelID: "fast-1" },
				variant: "high",
				system: "Primary folder: /projects/app",
			},
		]);
		// Until its turn shows, what the person sends waits behind it.
		expect(queue.getState().queues.ses_a).toEqual({
			items: [],
			paused: false,
			editing: null,
			sending: true,
		});

		setStatus(fake, "ses_a", "busy");
		expect(queue.getState().queues.ses_a).toBeUndefined();
	});

	it("sends one prompt per turn, in order, waiting for the turn each one starts", async () => {
		const { fake, enqueue, sent, items, turn } = await bootBusy();
		await enqueue("First");
		await enqueue("Second");

		setStatus(fake, "ses_a", "idle");
		await settle();
		// An idle report from before the server started "First" doesn't release "Second".
		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["First"]);
		expect(items()).toEqual(["Second"]);

		await turn();

		expect(sent()).toEqual(["First", "Second"]);
	});

	it("sends at once when the chat is idle", async () => {
		const { fake, enqueue, sent } = await bootBusy();
		setStatus(fake, "ses_a", "idle");

		await enqueue("Now");
		await settle();

		expect(sent()).toEqual(["Now"]);
	});

	it("runs a queued slash command as one", async () => {
		const { queue, fake } = await bootBusy();
		await queue.methods.enqueue({
			chatId: "ses_a",
			prompt: prompt("/review the diff", {
				command: { name: "review", arguments: "the diff" },
				agent: "code",
			}),
		});

		setStatus(fake, "ses_a", "idle");
		await settle();

		expect(fake.prompts).toEqual([
			{
				chatId: "ses_a",
				parts: [{ type: "text", text: "/review the diff" }],
				command: { name: "review", arguments: "the diff" },
				agent: "code",
			},
		]);
	});

	it("Send now stops the turn and sends that prompt before the others", async () => {
		const { queue, fake, enqueue, sent, items, turn } = await bootBusy();
		await enqueue("First");
		const second = await enqueue("Second");

		await queue.methods.steer({ chatId: "ses_a", id: second });
		await settle();
		expect(fake.aborts).toEqual(["ses_a"]);
		expect(sent()).toEqual([]);

		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["Second"]);
		expect(items()).toEqual(["First"]);

		await turn();
		expect(sent()).toEqual(["Second", "First"]);
	});

	it("sends a prompt queued with Send now in place of the turn", async () => {
		const { fake, enqueue, sent } = await bootBusy();

		await enqueue("Instead", { steer: true });
		await settle();
		expect(fake.aborts).toEqual(["ses_a"]);

		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["Instead"]);
	});

	it("holds what waits when the person stops the turn, until they resume", async () => {
		const { queue, fake, enqueue, sent } = await bootBusy();
		await enqueue("Later");

		await queue.methods.stopped({ chatId: "ses_a" });
		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(sent()).toEqual([]);
		expect(queue.getState().queues.ses_a?.paused).toBe(true);

		await queue.methods.resume({ chatId: "ses_a" });
		await settle();
		expect(sent()).toEqual(["Later"]);
	});

	it("without queue editing, holds only what waited when the turn was stopped", async () => {
		const { queue, fake, enqueue, sent, turn } = await bootBusy({ queueEditing: false });
		const parked = await enqueue("Parked");

		await queue.methods.stopped({ chatId: "ses_a" });
		setStatus(fake, "ses_a", "idle");
		await settle();
		await enqueue("After stop");
		await settle();
		expect(sent()).toEqual(["After stop"]);

		await turn();
		expect(sent()).toEqual(["After stop"]);

		await queue.methods.steer({ chatId: "ses_a", id: parked });
		await settle();
		expect(sent()).toEqual(["After stop", "Parked"]);
	});

	it("keeps a prompt the server refused, paused, for the person to send again", async () => {
		const { queue, fake, enqueue, sent, items } = await bootBusy();
		const id = await enqueue("Refused");
		fake.failPrompts = true;

		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(items()).toEqual(["Refused"]);
		expect(queue.getState().queues.ses_a?.paused).toBe(true);

		fake.failPrompts = false;
		await queue.methods.steer({ chatId: "ses_a", id });
		await settle();
		expect(sent()).toEqual(["Refused"]);
	});

	it("keeps a prompt the window could not send, paused rather than retried", async () => {
		const { queue, fake, sent, items } = await bootBusy();
		setStatus(fake, "ses_a", "idle");

		await queue.methods.enqueue({ chatId: "ses_a", prompt: prompt("Unsent"), failed: true });
		await settle();

		expect(sent()).toEqual([]);
		expect(items()).toEqual(["Unsent"]);
		expect(queue.getState().queues.ses_a?.paused).toBe(true);
	});

	it("pauses when Send now cannot stop the turn", async () => {
		const { queue, fake, enqueue } = await bootBusy();
		const id = await enqueue("Urgent");
		fake.failAborts = true;

		await queue.methods.steer({ chatId: "ses_a", id });
		await settle();

		expect(queue.getState().queues.ses_a?.paused).toBe(true);
		expect(fake.prompts).toEqual([]);
	});

	it("reorders, removes and edits what waits; an open edit holds the queue", async () => {
		const { queue, fake, enqueue, sent, items, turn } = await bootBusy();
		const first = await enqueue("First");
		const second = await enqueue("Second");
		const third = await enqueue("Third");

		await queue.methods.reorder({ chatId: "ses_a", ids: [second, first, "unknown"] });
		expect(items()).toEqual(["Second", "First", "Third"]);
		await queue.methods.remove({ chatId: "ses_a", id: third });
		expect(items()).toEqual(["Second", "First"]);

		await expect(queue.methods.beginEdit({ chatId: "ses_a", id: first })).resolves.toEqual({
			draft: "First",
		});
		await queue.methods.setEditDraft({ chatId: "ses_a", text: "First, edited" });
		expect(queue.getState().queues.ses_a?.editing).toEqual({ id: first, draft: "First, edited" });
		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(sent()).toEqual([]);

		await expect(
			queue.methods.commitEdit({
				chatId: "ses_a",
				id: first,
				text: { text: "", textParts: [] },
			}),
		).resolves.toBe(false);
		await expect(
			queue.methods.commitEdit({
				chatId: "ses_a",
				id: first,
				text: { text: "First, edited", textParts: [{ type: "text", text: "First, edited" }] },
			}),
		).resolves.toBe(true);
		await settle();
		expect(sent()).toEqual(["Second"]);
		expect(queue.getState().queues.ses_a).toMatchObject({
			items: [{ prompt: "First, edited" }],
			editing: null,
		});

		await turn();
		expect(sent()).toEqual(["Second", "First, edited"]);
	});

	it("reopens an edit with its unsaved text, and releases the queue when cancelled", async () => {
		const { queue, fake, enqueue, sent } = await bootBusy();
		const id = await enqueue("Draft me");
		await queue.methods.beginEdit({ chatId: "ses_a", id });
		await queue.methods.setEditDraft({ chatId: "ses_a", text: "Half done" });
		setStatus(fake, "ses_a", "idle");

		await expect(queue.methods.beginEdit({ chatId: "ses_a", id })).resolves.toEqual({
			draft: "Half done",
		});
		await queue.methods.cancelEdit({ chatId: "ses_a" });
		await settle();

		expect(sent()).toEqual(["Draft me"]);
	});

	it("turns a pause into held prompts and back when queue editing is switched", async () => {
		const booted = await bootBusy({ queueEditing: true });
		const { queue, fake, enqueue, sent } = booted;
		await enqueue("Held");
		await queue.methods.pause({ chatId: "ses_a" });

		booted.setQueueEditing(false);
		setStatus(fake, "ses_a", "idle");
		await settle();
		expect(sent()).toEqual([]);
		expect(queue.getState().queues.ses_a?.paused).toBe(false);

		booted.setQueueEditing(true);
		expect(queue.getState().queues.ses_a?.paused).toBe(true);
	});

	it("drops a chat's queue when it is cleared or the chat is deleted", async () => {
		const { queue, fake, enqueue, items } = await bootBusy({ chats: ["ses_a"] });
		await enqueue("Gone");
		await queue.methods.clear({ chatId: "ses_a" });
		expect(items()).toEqual([]);

		await enqueue("Also gone");
		fake.conversations!.emit("deleted", { chat: working("ses_a") });
		expect(queue.getState().queues).toEqual({});
	});

	it("holds prompts while the chat's status is unknown", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], ready: false });
		const queue = booted.asChat.promptQueue;
		await queue.methods.enqueue({ chatId: "ses_a", prompt: prompt("Soon") });
		await settle();
		expect(booted.fake.prompts).toEqual([]);

		booted.fake.conversations!.setState({ ...booted.fake.conversations!.state, ready: true });
		await settle();

		expect(booted.fake.prompts).toHaveLength(1);
	});

	it("queues only for kilo.chat", async () => {
		const { as } = await bootBusy();

		await expect(
			as("kilo.account").promptQueue.methods.enqueue({ chatId: "ses_a", prompt: prompt("Hi") }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});
});
