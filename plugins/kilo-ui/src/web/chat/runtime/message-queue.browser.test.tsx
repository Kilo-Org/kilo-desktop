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
		queue.setRunning(false);
		await Promise.resolve();
		expect(failedDriver.send).toHaveBeenCalledOnce();

		const retryDriver = createDriver();
		queue.setDriver(retryDriver);
		queue.adapter.steer(queue.adapter.items[0]!.id);
		await vi.waitFor(() => expect(retryDriver.send).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(queue.adapter.items).toHaveLength(0));
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
