import type { AppendMessage } from "@assistant-ui/react";
import { createOpenCodeMessageQueue } from "@assistant-ui/react-opencode";
import { describe, expect, it, vi } from "vitest";

const message = (text: string, startRun?: boolean): AppendMessage => ({
	role: "user",
	content: text ? [{ type: "text", text }] : [],
	attachments: [],
	createdAt: new Date(),
	parentId: null,
	sourceId: null,
	runConfig: {},
	metadata: { custom: {} },
	...(startRun === undefined ? {} : { startRun }),
});

const createDriver = () => ({
	send: vi.fn(async (_message: AppendMessage) => undefined),
	cancel: vi.fn(async () => undefined),
});

const finishStartedRun = (queue: ReturnType<typeof createOpenCodeMessageQueue>) => {
	queue.setRunning(true);
	queue.setRunning(false);
};

describe("OpenCode message queue", () => {
	it("does not expose a message that can dispatch immediately", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		let accept: (() => void) | undefined;
		const driver = {
			send: vi.fn(
				(_message: AppendMessage) =>
					new Promise<void>((resolve) => {
						accept = resolve;
					}),
			),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);

		queue.adapter.enqueue(message("send directly"), { steer: false });

		expect(driver.send).toHaveBeenCalledOnce();
		expect(queue.adapter.items).toHaveLength(0);
		accept?.();
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(0));
	});

	it("drains queued messages in FIFO order as runs become idle", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);

		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("second"), { steer: false });
		queue.adapter.enqueue(message("third"), { steer: false });

		expect(driver.send).not.toHaveBeenCalled();
		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["first", "second", "third"]);

		queue.setRunning(false);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(1));
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("first").content });

		finishStartedRun(queue);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(2));
		expect(driver.send.mock.calls[1]?.[0]).toMatchObject({ content: message("second").content });

		finishStartedRun(queue);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(3));
		expect(driver.send.mock.calls[2]?.[0]).toMatchObject({ content: message("third").content });
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(0));
	});

	it("sends a selected item after cancellation and preserves the remaining order", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("second"), { steer: false });
		queue.adapter.enqueue(message("urgent"), { steer: false });

		const urgentId = queue.adapter.items[2]!.id;
		queue.adapter.steer(urgentId);

		await vi.waitFor(() => expect(driver.cancel).toHaveBeenCalledOnce());
		expect(driver.send).not.toHaveBeenCalled();

		queue.setRunning(false);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("urgent").content });
		await vi.waitFor(() =>
			expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["first", "second"]),
		);

		finishStartedRun(queue);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(2));
		expect(driver.send.mock.calls[1]?.[0]).toMatchObject({ content: message("first").content });
	});

	it("keeps queued messages parked after Stop once the run finishes", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("second"), { steer: false });

		queue.adapter.clear("cancel-run");
		queue.setRunning(false);
		await Promise.resolve();

		expect(driver.send).not.toHaveBeenCalled();
		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["first", "second"]);
	});

	it("sends a new message after Stop while earlier ones stay parked", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("parked"), { steer: false });
		queue.adapter.clear("cancel-run");
		queue.setRunning(false);

		queue.adapter.enqueue(message("fresh"), { steer: false });

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("fresh").content });
		finishStartedRun(queue);
		await Promise.resolve();
		expect(driver.send).toHaveBeenCalledOnce();
		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["parked"]);
	});

	it("drains a message queued while the stopped run winds down", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("parked"), { steer: false });
		queue.adapter.clear("cancel-run");
		queue.adapter.enqueue(message("after stop"), { steer: false });

		queue.setRunning(false);

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({
			content: message("after stop").content,
		});
		await vi.waitFor(() =>
			expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["parked"]),
		);
	});

	it("sends a parked message when it is explicitly steered", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("second"), { steer: false });
		queue.adapter.clear("cancel-run");
		queue.setRunning(false);

		queue.adapter.steer(queue.adapter.items[1]!.id);

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("second").content });
		finishStartedRun(queue);
		await Promise.resolve();
		expect(driver.send).toHaveBeenCalledOnce();
		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["first"]);
	});

	it("queues a new message behind a failed send instead of sending it", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void>>()
				.mockRejectedValueOnce(new Error("send failed"))
				.mockResolvedValue(undefined),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);
		queue.adapter.enqueue(message("failed"), { steer: false });
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(1));

		queue.adapter.enqueue(message("held"), { steer: false });

		expect(driver.send).toHaveBeenCalledOnce();
		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["failed", "held"]);
	});

	it("does not auto-resume when cancel-run follows a failed send", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const failingDriver = {
			send: vi.fn(async (_message: AppendMessage) => Promise.reject(new Error("send failed"))),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(failingDriver);

		// Enqueue two messages; the first dispatch fails, pausing the queue.
		queue.adapter.enqueue(message("will-fail"), { steer: false });
		queue.adapter.enqueue(message("second"), { steer: false });
		await vi.waitFor(() => expect(failingDriver.send).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(2));

		// Now the user presses Stop on an unrelated running turn.
		queue.setRunning(true);
		queue.adapter.clear("cancel-run");
		queue.setRunning(false);

		// The queue must stay paused because the original pause was from a failed
		// send, not from cancel-run. Auto-resume would silently retry the rejected
		// message without user intent.
		await Promise.resolve();
		expect(failingDriver.send).toHaveBeenCalledOnce();
		expect(queue.adapter.items).toHaveLength(2);
	});

	it("deletes waiting messages without affecting the active run", () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("keep"), { steer: false });
		queue.adapter.enqueue(message("delete"), { steer: false });

		queue.adapter.remove(queue.adapter.items[1]!.id);

		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["keep"]);
		expect(driver.cancel).not.toHaveBeenCalled();
		expect(driver.send).not.toHaveBeenCalled();
	});

	it("keeps a rejected send queued and paused for an explicit retry", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const failedDriver = {
			send: vi.fn(async (_message: AppendMessage) => Promise.reject(new Error("send failed"))),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(failedDriver);
		queue.adapter.enqueue(message("retry me"), { steer: false });

		await vi.waitFor(() => expect(failedDriver.send).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(1));
		expect(queue.getControlsState().paused).toBe(true);
		queue.setRunning(false);
		await Promise.resolve();
		expect(failedDriver.send).toHaveBeenCalledOnce();

		const retryDriver = createDriver();
		queue.setDriver(retryDriver);
		queue.adapter.steer(queue.adapter.items[0]!.id);
		await vi.waitFor(() => expect(retryDriver.send).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(0));
	});

	it("drops a send returned to the composer and dispatches the next message immediately", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void | "returned-to-composer">>()
				.mockResolvedValueOnce("returned-to-composer")
				.mockResolvedValue(undefined),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);

		queue.adapter.enqueue(message("bounced"), { steer: false });
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(queue.adapter.items).toHaveLength(0);

		queue.adapter.enqueue(message("retry"), { steer: false });

		expect(driver.send).toHaveBeenCalledTimes(2);
		expect(driver.send.mock.calls[1]?.[0]).toMatchObject({ content: message("retry").content });
		expect(queue.adapter.items).toHaveLength(0);
	});

	it("resumes dispatching once the last entry of a paused queue is removed", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void>>()
				.mockRejectedValueOnce(new Error("send failed"))
				.mockResolvedValue(undefined),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);
		queue.adapter.enqueue(message("failed"), { steer: false });
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(1));

		queue.adapter.remove(queue.adapter.items[0]!.id);
		queue.adapter.enqueue(message("fresh"), { steer: false });

		expect(driver.send).toHaveBeenCalledTimes(2);
		expect(driver.send.mock.calls[1]?.[0]).toMatchObject({ content: message("fresh").content });
		expect(queue.adapter.items).toHaveLength(0);
	});

	it("keeps a selected item queued when cancellation fails", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = {
			send: vi.fn(async (_message: AppendMessage) => undefined),
			cancel: vi.fn(async () => Promise.reject(new Error("abort failed"))),
		};
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("urgent"), { steer: false });

		queue.adapter.steer(queue.adapter.items[0]!.id);

		await vi.waitFor(() => expect(driver.cancel).toHaveBeenCalledOnce());
		expect(driver.send).not.toHaveBeenCalled();
		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["urgent"]);
	});

	it("uses the latest dispatch driver and isolates separate chat queues", async () => {
		const firstChat = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const secondChat = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const staleDriver = createDriver();
		const currentDriver = createDriver();
		const secondDriver = createDriver();
		firstChat.setDriver(staleDriver);
		secondChat.setDriver(secondDriver);
		firstChat.setRunning(true);
		secondChat.setRunning(true);
		firstChat.adapter.enqueue(message("first chat"), { steer: false });
		secondChat.adapter.enqueue(message("second chat"), { steer: false });

		firstChat.setDriver(currentDriver);
		firstChat.setRunning(false);
		await vi.waitFor(() => expect(currentDriver.send).toHaveBeenCalledOnce());

		expect(staleDriver.send).not.toHaveBeenCalled();
		expect(secondDriver.send).not.toHaveBeenCalled();
		expect(secondChat.adapter.items.map((item) => item.prompt)).toEqual(["second chat"]);
	});

	it("ignores a stale idle snapshot replayed after an optimistic run start", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const previousRun = {};
		const idleBeforeDispatch = {};
		const backendRunStarted = {};
		const backendRunFinished = {};
		let acceptFirst: (() => void) | undefined;
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void>>()
				.mockImplementationOnce(
					() =>
						new Promise<void>((resolve) => {
							acceptFirst = resolve;
						}),
				)
				.mockResolvedValue(undefined),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);
		queue.setRunning(true, previousRun);
		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("second"), { steer: false });

		queue.setRunning(false, idleBeforeDispatch);
		expect(driver.send).toHaveBeenCalledOnce();

		queue.setRunning(true, idleBeforeDispatch);
		queue.setRunning(false, idleBeforeDispatch);
		acceptFirst?.();
		await vi.waitFor(() =>
			expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["second"]),
		);
		expect(driver.send).toHaveBeenCalledOnce();

		queue.setRunning(true, backendRunStarted);
		queue.setRunning(false, idleBeforeDispatch);
		expect(driver.send).toHaveBeenCalledOnce();

		queue.setRunning(false, backendRunFinished);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(2));
	});

	it("sends tool-blocking follow-ups immediately without cancelling", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);

		queue.adapter.enqueue(message("answer suggestion", false), { steer: false });

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.cancel).not.toHaveBeenCalled();
		expect(driver.send.mock.calls[0]?.[0]?.startRun).toBe(true);
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(0));
	});

	it("preserves a tool-blocking follow-up while another queue operation is in flight", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		let acceptFirst: (() => void) | undefined;
		let acceptFollowup: (() => void) | undefined;
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void>>()
				.mockImplementationOnce(
					() =>
						new Promise<void>((resolve) => {
							acceptFirst = resolve;
						}),
				)
				.mockImplementationOnce(
					() =>
						new Promise<void>((resolve) => {
							acceptFollowup = resolve;
						}),
				),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);

		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("answer suggestion", false), { steer: false });

		expect(queue.adapter.items.map((item) => item.prompt)).toEqual(["answer suggestion"]);
		acceptFirst?.();
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(2));
		expect(driver.send.mock.calls[1]?.[0]?.startRun).toBe(true);
		expect(queue.adapter.items).toHaveLength(0);
		acceptFollowup?.();
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(0));
	});

	it("sends a tool-blocking follow-up after an in-flight send fails", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		let rejectFirst: (() => void) | undefined;
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void>>()
				.mockImplementationOnce(
					() =>
						new Promise<void>((_resolve, reject) => {
							rejectFirst = () => reject(new Error("send failed"));
						}),
				)
				.mockResolvedValueOnce(undefined),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);

		queue.adapter.enqueue(message("first"), { steer: false });
		queue.adapter.enqueue(message("answer suggestion", false), { steer: false });
		rejectFirst?.();

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledTimes(2));
		expect(driver.send.mock.calls[1]?.[0]?.startRun).toBe(true);
	});

	it("sends a tool-blocking follow-up after an in-flight cancellation settles", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		let acceptCancellation: (() => void) | undefined;
		const driver = {
			send: vi.fn(async (_message: AppendMessage) => undefined),
			cancel: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						acceptCancellation = resolve;
					}),
			),
		};
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("send next"), { steer: false });

		queue.adapter.steer(queue.adapter.items[0]!.id);
		queue.adapter.enqueue(message("answer suggestion", false), { steer: false });

		expect(driver.cancel).toHaveBeenCalledOnce();
		expect(queue.adapter.items.map((item) => item.prompt)).toContain("answer suggestion");
		acceptCancellation?.();
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]?.startRun).toBe(true);
	});

	it("sends a tool-blocking follow-up after an in-flight cancellation fails", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		let rejectCancellation: (() => void) | undefined;
		const driver = {
			send: vi.fn(async (_message: AppendMessage) => undefined),
			cancel: vi.fn(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectCancellation = () => reject(new Error("abort failed"));
					}),
			),
		};
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("send next"), { steer: false });

		queue.adapter.steer(queue.adapter.items[0]!.id);
		queue.adapter.enqueue(message("answer suggestion", false), { steer: false });
		rejectCancellation?.();

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]?.startRun).toBe(true);
	});

	it("uses an attachment fallback preview", () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		queue.setDriver(createDriver());
		queue.setRunning(true);
		queue.adapter.enqueue(
			{
				...message(""),
				attachments: [
					{
						id: "file-1",
						type: "file",
						name: "notes.txt",
						contentType: "text/plain",
						status: { type: "complete" },
						content: [],
					},
				],
			},
			{ steer: false },
		);

		expect(queue.adapter.items[0]?.prompt).toBe("Attachment");
	});

	it("exposes the first uploaded image for the queue thumbnail", () => {
		const firstImage = "data:image/png;base64,first-image";
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		queue.setDriver(createDriver());
		queue.setRunning(true);
		queue.adapter.enqueue(
			{
				...message("Review these images"),
				attachments: [
					{
						id: "image-1",
						type: "image",
						name: "first.png",
						contentType: "image/png",
						status: { type: "complete" },
						content: [{ type: "image", image: firstImage }],
					},
					{
						id: "image-2",
						type: "image",
						name: "second.png",
						contentType: "image/png",
						status: { type: "complete" },
						content: [{ type: "image", image: "data:image/png;base64,second-image" }],
					},
				],
			},
			{ steer: false },
		);

		expect(queue.adapter.items[0]).toMatchObject({
			attachmentPreview: { name: "first.png", src: firstImage },
		});
	});
});

const prompts = (queue: ReturnType<typeof createOpenCodeMessageQueue>) =>
	queue.adapter.items.map((item) => item.prompt);

const idOf = (queue: ReturnType<typeof createOpenCodeMessageQueue>, prompt: string) => {
	const item = queue.adapter.items.find((candidate) => candidate.prompt === prompt);
	if (!item) throw new Error(`No queued item "${prompt}"`);
	return item.id;
};

const USER_CONTROLS = { cancelBehavior: "pause", userControls: true } as const;

const runningQueueWith = (...texts: string[]) => {
	const queue = createOpenCodeMessageQueue(USER_CONTROLS);
	const driver = createDriver();
	queue.setDriver(driver);
	queue.setRunning(true);
	for (const text of texts) queue.adapter.enqueue(message(text), { steer: false });
	return { queue, driver };
};

describe("OpenCode message queue with user controls: Stop", () => {
	it("pauses the queue on Stop so nothing sends once the run finishes", async () => {
		const { queue, driver } = runningQueueWith("first", "second");

		queue.adapter.clear("cancel-run");
		queue.setRunning(false);
		await Promise.resolve();

		expect(driver.send).not.toHaveBeenCalled();
		expect(prompts(queue)).toEqual(["first", "second"]);
		expect(queue.getControlsState().paused).toBe(true);
	});

	it("does not pause future queueing when Stop hits an empty queue", () => {
		const { queue } = runningQueueWith();

		queue.adapter.clear("cancel-run");

		expect(queue.getControlsState().paused).toBe(false);
	});

	it("holds a message queued while the stopped run winds down behind the pause", async () => {
		const { queue, driver } = runningQueueWith("held");
		queue.adapter.clear("cancel-run");
		queue.adapter.enqueue(message("after stop"), { steer: false });

		queue.setRunning(false);
		await Promise.resolve();

		expect(driver.send).not.toHaveBeenCalled();
		expect(prompts(queue)).toEqual(["held", "after stop"]);
	});

	it("sends a paused message when it is explicitly steered and stays paused", async () => {
		const { queue, driver } = runningQueueWith("first", "second");
		queue.adapter.clear("cancel-run");
		queue.setRunning(false);

		queue.adapter.steer(idOf(queue, "second"));

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("second").content });
		finishStartedRun(queue);
		await Promise.resolve();
		expect(driver.send).toHaveBeenCalledOnce();
		expect(prompts(queue)).toEqual(["first"]);
		expect(queue.getControlsState().paused).toBe(true);
	});

	it("shows a failed send as a visible pause", async () => {
		const queue = createOpenCodeMessageQueue(USER_CONTROLS);
		queue.setDriver({
			send: vi.fn(async (_message: AppendMessage) => Promise.reject(new Error("send failed"))),
			cancel: vi.fn(async () => undefined),
		});

		queue.adapter.enqueue(message("retry me"), { steer: false });

		await vi.waitFor(() => expect(queue.getControlsState().paused).toBe(true));
		expect(prompts(queue)).toEqual(["retry me"]);
	});
});

describe("OpenCode message queue mode switch", () => {
	it("turns legacy parked messages into a visible pause when user controls switch on", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		queue.adapter.enqueue(message("parked"), { steer: false });
		queue.adapter.clear("cancel-run");
		queue.setRunning(false);

		queue.setOptions(USER_CONTROLS);

		expect(queue.getControlsState().paused).toBe(true);
		expect(driver.send).not.toHaveBeenCalled();
		queue.resume();
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
	});

	it("parks paused messages and drops the edit hold when user controls switch off", async () => {
		const { queue, driver } = runningQueueWith("held", "editing");
		queue.pause();
		queue.beginEdit(idOf(queue, "editing"));

		queue.setOptions({ cancelBehavior: "pause" });
		queue.setRunning(false);
		await Promise.resolve();

		expect(queue.getControlsState()).toEqual({ paused: false, editingId: undefined });
		expect(driver.send).not.toHaveBeenCalled();
		expect(prompts(queue)).toEqual(["held", "editing"]);

		queue.adapter.enqueue(message("fresh"), { steer: false });
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("fresh").content });
	});

	it("parks the message being edited instead of sending it when user controls switch off", async () => {
		const { queue, driver } = runningQueueWith("editing", "next");
		queue.beginEdit(idOf(queue, "editing"));
		queue.setEditDraft("unsaved");
		queue.setRunning(false);
		await Promise.resolve();

		queue.setOptions({ cancelBehavior: "pause" });
		await Promise.resolve();

		expect(driver.send).not.toHaveBeenCalled();
		expect(prompts(queue)).toEqual(["editing", "next"]);
		expect(queue.getControlsState()).toEqual({ paused: false, editingId: undefined });
		expect(queue.getEditDraft()).toBeUndefined();

		queue.setOptions(USER_CONTROLS);

		expect(queue.getControlsState().paused).toBe(true);
	});

	it("keeps draining when user controls switch off on a live queue", async () => {
		const { queue, driver } = runningQueueWith("next");

		queue.setOptions({ cancelBehavior: "pause" });
		queue.setRunning(false);

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
	});
});

describe("OpenCode message queue reorder", () => {
	it("reorders waiting messages and drains the new head first", async () => {
		const { queue, driver } = runningQueueWith("a", "b", "c");

		queue.reorder([idOf(queue, "c"), idOf(queue, "a"), idOf(queue, "b")]);

		expect(prompts(queue)).toEqual(["c", "a", "b"]);
		queue.setRunning(false);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("c").content });
	});

	it("ignores unknown ids and keeps unlisted messages after the listed ones", () => {
		const { queue } = runningQueueWith("a", "b", "c");

		queue.reorder(["missing", idOf(queue, "c")]);

		expect(prompts(queue)).toEqual(["c", "a", "b"]);
	});

	it("keeps an in-flight message out of the reorder", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		let accept: (() => void) | undefined;
		const driver = {
			send: vi
				.fn<(message: AppendMessage) => Promise<void>>()
				.mockImplementationOnce(
					() =>
						new Promise<void>((resolve) => {
							accept = resolve;
						}),
				)
				.mockResolvedValue(undefined),
			cancel: vi.fn(async () => undefined),
		};
		queue.setDriver(driver);
		queue.adapter.enqueue(message("in flight"), { steer: false });
		queue.adapter.enqueue(message("b"), { steer: false });
		queue.adapter.enqueue(message("c"), { steer: false });

		queue.reorder([idOf(queue, "c"), idOf(queue, "b")]);
		accept?.();

		await vi.waitFor(() => expect(prompts(queue)).toEqual(["c", "b"]));
		expect(driver.send).toHaveBeenCalledOnce();
	});
});

describe("OpenCode message queue pause", () => {
	it("does not auto-send while paused and drains on resume", async () => {
		const { queue, driver } = runningQueueWith("a", "b");

		queue.pause();
		queue.setRunning(false);
		await Promise.resolve();

		expect(queue.getControlsState().paused).toBe(true);
		expect(driver.send).not.toHaveBeenCalled();

		queue.resume();

		expect(queue.getControlsState().paused).toBe(false);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("a").content });
	});

	it("waits for the active run to finish when resumed while running", async () => {
		const { queue, driver } = runningQueueWith("a");

		queue.pause();
		queue.resume();
		await Promise.resolve();
		expect(driver.send).not.toHaveBeenCalled();

		queue.setRunning(false);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
	});

	it("sends a new message immediately while paused if the agent is idle", async () => {
		const { queue, driver } = runningQueueWith("held");
		queue.pause();
		queue.setRunning(false);

		queue.adapter.enqueue(message("fresh"), { steer: false });

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("fresh").content });
		expect(prompts(queue)).toEqual(["held"]);
	});

	it("unpauses once the queue empties", () => {
		const { queue } = runningQueueWith("only");
		queue.pause();

		queue.adapter.remove(idOf(queue, "only"));

		expect(queue.getControlsState().paused).toBe(false);
	});

	it("notifies subscribers when the paused state changes", () => {
		const { queue } = runningQueueWith("a");
		const listener = vi.fn();
		queue.subscribe(listener);
		const before = queue.getSnapshot();

		queue.pause();

		expect(listener).toHaveBeenCalled();
		expect(queue.getSnapshot()).not.toBe(before);
	});
});

describe("OpenCode message queue edit", () => {
	it("returns the raw text and holds draining while a message is edited", async () => {
		const { queue, driver } = runningQueueWith("a", "b");

		expect(queue.beginEdit(idOf(queue, "a"))).toBe("a");
		expect(queue.getControlsState().editingId).toBe(idOf(queue, "a"));

		queue.setRunning(false);
		await Promise.resolve();
		expect(driver.send).not.toHaveBeenCalled();

		queue.cancelEdit();

		expect(queue.getControlsState().editingId).toBeUndefined();
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("a").content });
	});

	it("replaces the text in place and keeps attachments", async () => {
		const queue = createOpenCodeMessageQueue({ cancelBehavior: "pause" });
		const driver = createDriver();
		queue.setDriver(driver);
		queue.setRunning(true);
		const attachment = {
			id: "file-1",
			type: "file" as const,
			name: "notes.txt",
			contentType: "text/plain",
			status: { type: "complete" as const },
			content: [],
		};
		queue.adapter.enqueue({ ...message("old"), attachments: [attachment] }, { steer: false });
		queue.adapter.enqueue(message("next"), { steer: false });
		const id = idOf(queue, "old");

		queue.beginEdit(id);
		expect(queue.commitEdit(id, "new text")).toBe(true);

		expect(prompts(queue)).toEqual(["new text", "next"]);
		expect(queue.adapter.items[0]).toMatchObject({ id, attachmentPreview: { name: "notes.txt" } });
		expect(queue.getControlsState().editingId).toBeUndefined();

		queue.setRunning(false);
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({
			content: [{ type: "text", text: "new text" }],
			attachments: [attachment],
		});
	});

	it("keeps an edit and its draft open until it is saved, then drains right away", async () => {
		const { queue, driver } = runningQueueWith("original", "next");
		const id = idOf(queue, "original");
		queue.beginEdit(id);
		queue.setEditDraft("revised");

		queue.setRunning(false);
		await Promise.resolve();

		expect(driver.send).not.toHaveBeenCalled();
		expect(queue.beginEdit(id)).toBe("revised");
		expect(queue.getEditDraft()).toBe("revised");

		queue.commitEdit(id, queue.getEditDraft() ?? "");

		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({
			content: [{ type: "text", text: "revised" }],
		});
		expect(queue.getEditDraft()).toBeUndefined();
	});

	it("drops the draft when an edit is cancelled", () => {
		const { queue } = runningQueueWith("original");
		queue.beginEdit(idOf(queue, "original"));
		queue.setEditDraft("revised");

		queue.cancelEdit();

		expect(queue.getEditDraft()).toBeUndefined();
		expect(queue.beginEdit(idOf(queue, "original"))).toBe("original");
	});

	it("rejects an edit that would leave an empty message", () => {
		const { queue } = runningQueueWith("a");
		const id = idOf(queue, "a");
		queue.beginEdit(id);

		expect(queue.commitEdit(id, "   ")).toBe(false);
		expect(prompts(queue)).toEqual(["a"]);
		expect(queue.getControlsState().editingId).toBe(id);
	});

	it("refuses to steer the message being edited", async () => {
		const { queue, driver } = runningQueueWith("a");
		const id = idOf(queue, "a");
		queue.beginEdit(id);

		queue.adapter.steer(id);
		await Promise.resolve();

		expect(driver.cancel).not.toHaveBeenCalled();
		expect(prompts(queue)).toEqual(["a"]);
	});

	it("releases the edit hold when the edited message is removed", async () => {
		const { queue, driver } = runningQueueWith("a", "b");
		queue.beginEdit(idOf(queue, "a"));

		queue.adapter.remove(idOf(queue, "a"));
		queue.setRunning(false);

		expect(queue.getControlsState().editingId).toBeUndefined();
		await vi.waitFor(() => expect(driver.send).toHaveBeenCalledOnce());
		expect(driver.send.mock.calls[0]?.[0]).toMatchObject({ content: message("b").content });
	});
});
