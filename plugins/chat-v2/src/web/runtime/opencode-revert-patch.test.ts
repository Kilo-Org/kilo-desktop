import {
	createOpenCodeThreadState,
	OpenCodeThreadController,
	projectOpenCodeThreadMessages,
	type KiloClient,
	type OpenCodeServerMessage,
	type OpenCodeThreadState,
} from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it, vi } from "vitest";

const user = (id: string, text: string): OpenCodeServerMessage => ({
	id,
	type: "user",
	text,
	time: { created: 1 },
});

const reply = (id: string, text: string): OpenCodeServerMessage => ({
	id,
	type: "assistant",
	agent: "code",
	model: { providerID: "provider", id: "model" },
	time: { created: 1, completed: 2 },
	finish: "stop",
	content: [{ type: "text", text }],
});

const stateWithMessages = (
	messages: readonly OpenCodeServerMessage[],
	revert?: { messageID: string },
): OpenCodeThreadState => ({
	...createOpenCodeThreadState("ses_1"),
	session: (revert ? { id: "ses_1", revert } : { id: "ses_1" }) as never,
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
});

const projectedIds = (state: OpenCodeThreadState) =>
	projectOpenCodeThreadMessages(state).map((message) => message.id);

/*
 * A staged revert (`session.revert.messageID`) undoes its boundary message and
 * everything after it: the thread hides them until the revert is committed or
 * cleared. The boundary is found by its place in the transcript; a boundary the
 * thread doesn't hold falls back to Kilo's ids, which ascend.
 */
describe("projectOpenCodeThreadMessages revert filtering", () => {
	it("hides the boundary message and everything after it while a revert is pending", () => {
		const state = stateWithMessages(
			[
				user("msg_1", "first"),
				reply("msg_2", "one"),
				user("msg_3", "second"),
				reply("msg_4", "two"),
			],
			{ messageID: "msg_3" },
		);
		expect(projectedIds(state)).toEqual(["msg_1", "msg_2"]);
	});

	it("projects every message when no revert is pending", () => {
		const state = stateWithMessages([user("msg_1", "first"), reply("msg_2", "one")]);
		expect(projectedIds(state)).toEqual(["msg_1", "msg_2"]);
	});

	it("finds the boundary by its place, whatever its id sorts as", () => {
		const state = stateWithMessages([user("zzz-1", "first"), user("aaa-2", "second")], {
			messageID: "aaa-2",
		});
		expect(projectedIds(state)).toEqual(["zzz-1"]);
	});

	it("falls back to id order for a boundary the thread doesn't hold", () => {
		const state = stateWithMessages([user("msg_1", "first"), user("msg_3", "third")], {
			messageID: "msg_2",
		});
		expect(projectedIds(state)).toEqual(["msg_1"]);
	});

	it("does not leak post-boundary steps into the earlier reply", () => {
		const state = stateWithMessages(
			[reply("msg_1", "answer one"), user("msg_2", "second"), reply("msg_3", "answer two")],
			{ messageID: "msg_2" },
		);
		const projected = projectOpenCodeThreadMessages(state);
		expect(projected.map((message) => message.id)).toEqual(["msg_1"]);
		expect(
			((projected[0]?.content ?? []) as unknown as { type: string }[]).filter(
				(part) => part.type === "text",
			),
		).toEqual([{ type: "text", text: "answer one" }]);
	});
});

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

/** A Kilo v2 session as `session.get` reads it, with `revert` when one is staged. */
const sessionInfo = (revert?: { messageID: string }) => ({
	id: "ses_1",
	projectID: "project",
	title: "Chat",
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	time: { created: 1, updated: 1 },
	location: { directory: "/p" },
	...(revert ? { revert } : {}),
});

const createController = ({
	stage = vi.fn().mockResolvedValue({ messageID: "user-2" }),
	clear = vi.fn().mockResolvedValue(undefined),
	get = vi.fn().mockResolvedValue(sessionInfo()),
}: {
	stage?: ReturnType<typeof vi.fn>;
	clear?: ReturnType<typeof vi.fn>;
	get?: ReturnType<typeof vi.fn>;
} = {}) =>
	new OpenCodeThreadController(
		{ session: { revert: { stage, clear }, get } } as never as KiloClient,
		() => ({
			subscribe: () => () => {},
		}),
		"ses_1",
	);

describe("OpenCodeThreadController.revert run state", () => {
	it("returns to idle after the server accepts the revert", async () => {
		const deferred = createDeferred<unknown>();
		const controller = createController({ stage: vi.fn(() => deferred.promise) });

		const revertPromise = controller.revert("user-2");
		expect(controller.getState().runState.type).toBe("reverting");

		deferred.resolve({ messageID: "user-2" });
		await revertPromise;

		const state = controller.getState();
		expect(state.runState.type).toBe("idle");
		expect(state.sessionStatus?.type).toBe("idle");
	});

	it("applies the session as it is once reverted", async () => {
		const stage = vi.fn().mockResolvedValue({ messageID: "user-2" });
		const controller = createController({
			stage,
			get: vi.fn().mockResolvedValue(sessionInfo({ messageID: "user-2" })),
		});

		await controller.revert("user-2");

		expect(stage).toHaveBeenCalledWith({ sessionID: "ses_1", messageID: "user-2" });
		expect(controller.getState().session?.revert).toEqual({ messageID: "user-2" });
		expect(controller.getState().runState.type).toBe("idle");
	});

	it("moves to the error state when the revert request fails", async () => {
		const controller = createController({
			stage: vi.fn().mockRejectedValue(new Error("revert rejected")),
		});

		await expect(controller.revert("user-2")).rejects.toThrow("revert rejected");
		expect(controller.getState().runState.type).toBe("error");
	});
});

describe("OpenCodeThreadController.unrevert run state", () => {
	it("is reverting while the HTTP call is stalled", async () => {
		const deferred = createDeferred<unknown>();
		const controller = createController({ clear: vi.fn(() => deferred.promise) });

		const unrevertPromise = controller.unrevert();
		expect(controller.getState().runState.type).toBe("reverting");

		deferred.resolve(undefined);
		await unrevertPromise;
	});

	it("applies the session, its revert cleared, and returns to idle on success", async () => {
		const clear = vi.fn().mockResolvedValue(undefined);
		const controller = createController({ clear });

		await controller.unrevert();

		expect(clear).toHaveBeenCalledWith({ sessionID: "ses_1" });
		expect(controller.getState().session).toMatchObject({ id: "ses_1" });
		expect(controller.getState().session?.revert).toBeUndefined();
		expect(controller.getState().runState.type).toBe("idle");
		expect(controller.getState().sessionStatus?.type).toBe("idle");
	});

	it("moves to the error state and rethrows when the unrevert request fails", async () => {
		const controller = createController({
			clear: vi.fn().mockRejectedValue(new Error("unrevert rejected")),
		});

		await expect(controller.unrevert()).rejects.toThrow("unrevert rejected");
		expect(controller.getState().runState.type).toBe("error");
	});
});
