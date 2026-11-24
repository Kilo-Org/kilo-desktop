import { describe, expect, it } from "vitest";

import { PromptQueues, type QueuedPrompt } from "../../contracts";
import { bootChatMain, chat, settle } from "../test-boot";

const working = (id: string) => {
	const summary = chat(id);
	return { ...summary, activity: { ...summary.activity, status: "busy" as const } };
};

function prompt(text: string, patch: Partial<QueuedPrompt> = {}): QueuedPrompt {
	return { text, textParts: [{ type: "text", text }], attachmentParts: [], ...patch };
}

async function bootBusy(options: { chats?: string[] } = {}) {
	const booted = await bootChatMain({
		chats: (options.chats ?? ["ses_a"]).map(working),
		workSessions: null,
	});
	const queue = booted.chatSdk.domainObjects.get(PromptQueues)!;
	const fake = booted.core;
	const setStatus = (chatId: string, status: "busy" | "idle") => fake.setStatus(chatId, status);
	const enqueue = async (text: string, extra: { steer?: boolean } = {}) => {
		const id = `p_${text}`;
		await queue.methods.enqueue({ chatId: "ses_a", id, prompt: prompt(text), ...extra });
		return id;
	};
	const sent = () => fake.prompts.map((input) => (input.parts[0] as { text: string }).text);
	const items = () => queue.getState().queues.ses_a?.items.map((item) => item.text) ?? [];
	/** One turn: the server starts the prompt just sent, then finishes it. */
	const turn = async () => {
		setStatus("ses_a", "busy");
		setStatus("ses_a", "idle");
		await settle();
	};
	return { ...booted, fake, queue, setStatus, enqueue, sent, items, turn };
}

describe("queued prompts", () => {
	it("sends a prompt queued while the chat works once its turn ends, as the window prepared it", async () => {
		const { queue, fake, setStatus } = await bootBusy();
		const attachment = {
			type: "file" as const,
			mime: "image/png",
			url: "data:image/png;base64,AAAA",
		};

		await queue.methods.enqueue({
			chatId: "ses_a",
			id: "p_1",
			prompt: prompt("Then add tests", {
				attachmentParts: [attachment],
				attachmentPreview: { name: "shot.png", src: attachment.url },
				agent: "code",
				model: { aiProviderId: "acme", modelId: "fast-1" },
				variant: "high",
				system: "Primary folder: /projects/app",
			}),
		});
		await settle();

		expect(fake.prompts).toEqual([]);
		expect(queue.getState().queues.ses_a).toEqual({
			items: [
				{
					id: "p_1",
					prompt: "Then add tests",
					text: "Then add tests",
					attachmentPreview: { name: "shot.png", src: attachment.url },
				},
			],
			paused: false,
			editing: null,
			sending: false,
		});

		setStatus("ses_a", "idle");
		await settle();

		expect(fake.prompts).toEqual([
			{
				chatId: "ses_a",
				parts: [{ type: "text", text: "Then add tests" }, attachment],
				agent: "code",
				model: { aiProviderId: "acme", modelId: "fast-1", variant: "high" },
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

		setStatus("ses_a", "busy");
		expect(queue.getState().queues.ses_a).toBeUndefined();
	});

	it("sends one prompt per turn, in order, waiting for the turn each one starts", async () => {
		const { setStatus, enqueue, sent, items, turn } = await bootBusy();
		await enqueue("First");
		await enqueue("Second");

		setStatus("ses_a", "idle");
		await settle();
		// An idle report from before the server started "First" doesn't release "Second".
		setStatus("ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["First"]);
		expect(items()).toEqual(["Second"]);

		await turn();

		expect(sent()).toEqual(["First", "Second"]);
	});

	it("sends at once when the chat is idle", async () => {
		const { setStatus, enqueue, sent } = await bootBusy();
		setStatus("ses_a", "idle");

		await enqueue("Now");
		await settle();

		expect(sent()).toEqual(["Now"]);
	});

	it("keeps the id the window chose, and ignores the same prompt queued again", async () => {
		const { queue, enqueue, items } = await bootBusy();

		const id = await enqueue("Once");
		await enqueue("Once");

		expect(items()).toEqual(["Once"]);
		expect(queue.getState().queues.ses_a?.items[0]?.id).toBe(id);
	});

	it("runs a queued slash command as one", async () => {
		const { queue, fake, setStatus } = await bootBusy();
		await queue.methods.enqueue({
			chatId: "ses_a",
			id: "p_1",
			prompt: prompt("/review the diff", {
				command: { name: "review", arguments: "the diff" },
				agent: "code",
			}),
		});

		setStatus("ses_a", "idle");
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
		const { queue, fake, setStatus, enqueue, sent, items, turn } = await bootBusy();
		await enqueue("First");
		const second = await enqueue("Second");

		await queue.methods.steer({ chatId: "ses_a", id: second });
		await settle();
		expect(fake.aborts).toEqual(["ses_a"]);
		expect(sent()).toEqual([]);

		setStatus("ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["Second"]);
		expect(items()).toEqual(["First"]);

		await turn();
		expect(sent()).toEqual(["Second", "First"]);
	});

	it("sends a prompt queued with Send now in place of the turn", async () => {
		const { fake, setStatus, enqueue, sent } = await bootBusy();

		await enqueue("Instead", { steer: true });
		await settle();
		expect(fake.aborts).toEqual(["ses_a"]);

		setStatus("ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["Instead"]);
	});

	it("holds what waits when the person stops the turn, until they resume", async () => {
		const { queue, setStatus, enqueue, sent } = await bootBusy();
		await enqueue("Later");

		await queue.methods.stopped({ chatId: "ses_a" });
		setStatus("ses_a", "idle");
		await settle();
		expect(sent()).toEqual([]);
		expect(queue.getState().queues.ses_a?.paused).toBe(true);

		await queue.methods.resume({ chatId: "ses_a" });
		await settle();
		expect(sent()).toEqual(["Later"]);
	});

	it("keeps a prompt the server refused, paused, for the person to send again", async () => {
		const { queue, fake, setStatus, enqueue, sent, items } = await bootBusy();
		const id = await enqueue("Refused");
		fake.failPrompts = true;

		setStatus("ses_a", "idle");
		await settle();
		expect(items()).toEqual(["Refused"]);
		expect(queue.getState().queues.ses_a?.paused).toBe(true);

		fake.failPrompts = false;
		await queue.methods.steer({ chatId: "ses_a", id });
		await settle();
		expect(sent()).toEqual(["Refused"]);
	});

	it("keeps a prompt the window could not send, paused rather than retried", async () => {
		const { queue, setStatus, sent, items } = await bootBusy();
		setStatus("ses_a", "idle");

		await queue.methods.enqueue({
			chatId: "ses_a",
			id: "p_1",
			prompt: prompt("Unsent"),
			failed: true,
		});
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
		const { queue, setStatus, enqueue, sent, items, turn } = await bootBusy();
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
		setStatus("ses_a", "idle");
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
		const { queue, setStatus, enqueue, sent } = await bootBusy();
		const id = await enqueue("Draft me");
		await queue.methods.beginEdit({ chatId: "ses_a", id });
		await queue.methods.setEditDraft({ chatId: "ses_a", text: "Half done" });
		setStatus("ses_a", "idle");

		await expect(queue.methods.beginEdit({ chatId: "ses_a", id })).resolves.toEqual({
			draft: "Half done",
		});
		await queue.methods.cancelEdit({ chatId: "ses_a" });
		await settle();

		expect(sent()).toEqual(["Draft me"]);
	});

	it("drops a chat's queue when it is cleared or the chat is deleted", async () => {
		const { queue, fake, enqueue, items } = await bootBusy({ chats: ["ses_a"] });
		await enqueue("Gone");
		await queue.methods.clear({ chatId: "ses_a" });
		expect(items()).toEqual([]);

		await enqueue("Also gone");
		fake.remove("ses_a");
		expect(queue.getState().queues).toEqual({});
	});

	it("holds prompts while the chat's status is unknown", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], ready: false, workSessions: null });
		const queue = booted.chatSdk.domainObjects.get(PromptQueues)!;
		await queue.methods.enqueue({ chatId: "ses_a", id: "p_1", prompt: prompt("Soon") });
		await settle();
		expect(booted.core.prompts).toEqual([]);

		booted.core.setReady(true);
		await settle();

		expect(booted.core.prompts).toHaveLength(1);
	});

	it("doesn't take the last turn's late work-completed for the next prompt's turn", async () => {
		const { fake, setStatus, enqueue, sent, turn } = await bootBusy();
		await enqueue("First");
		await enqueue("Second");
		setStatus("ses_a", "idle");
		await settle();
		expect(sent()).toEqual(["First"]);

		fake.completeWork("ses_a");
		await settle();
		expect(sent()).toEqual(["First"]);

		await turn();
		expect(sent()).toEqual(["First", "Second"]);
	});

	it("sends only the Send now prompt when the stopped turn's work-completed comes late", async () => {
		const { queue, fake, setStatus, enqueue, sent, items } = await bootBusy();
		await enqueue("First");
		const second = await enqueue("Second");

		await queue.methods.steer({ chatId: "ses_a", id: second });
		setStatus("ses_a", "idle");
		await settle();
		fake.completeWork("ses_a");
		await settle();

		expect(sent()).toEqual(["Second"]);
		expect(items()).toEqual(["First"]);
	});

	it("is told off when kilo.core's chats are gone", async () => {
		const booted = await bootChatMain({
			chats: [working("ses_a")],
			workSessions: null,
			removableCore: true,
		});
		const queue = booted.chatSdk.domainObjects.get(PromptQueues)!;
		const id = "p_1";
		await queue.methods.enqueue({ chatId: "ses_a", id, prompt: prompt("Orphan") });
		await booted.setCorePresent(false);

		await queue.methods.steer({ chatId: "ses_a", id });
		await settle();

		expect(queue.getState().queues.ses_a?.paused).toBe(true);
		expect(queue.getState().queues.ses_a?.items.map((item) => item.text)).toEqual(["Orphan"]);
	});

	it("queues only for kilo.chat", async () => {
		const { as } = await bootBusy();

		await expect(
			as("kilo.core")
				.get(PromptQueues)!
				.methods.enqueue({ chatId: "ses_a", id: "p_1", prompt: prompt("Hi") }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});
});
