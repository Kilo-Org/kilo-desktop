import {
	createOpenCodeThreadState,
	OpenCodeThreadController,
	projectOpenCodeThreadMessages,
	type OpencodeClient,
	type OpenCodeServerMessage,
	type OpenCodeThreadState,
} from "@assistant-ui/react-opencode";
import { describe, expect, it, vi } from "vitest";

const serverMessage = (
	id: string,
	role: "user" | "assistant",
	parts: Array<Record<string, unknown>> = [],
): OpenCodeServerMessage => ({
	id,
	info: {
		id,
		role,
		sessionID: "ses_1",
		modelID: "model",
		providerID: "provider",
		mode: "primary",
		path: { cwd: "/", root: "/" },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: Number(id.split("-")[1] ?? 1) },
		...(role === "assistant" ? { finish: "stop" } : {}),
	} as never,
	parts: parts as never,
	shadowParts: undefined,
});

const textPart = (id: string, text: string) => ({
	id,
	sessionID: "ses_1",
	messageID: id.split("_")[0],
	type: "text",
	text,
});

const stateWithMessages = (
	messages: readonly OpenCodeServerMessage[],
	session: Record<string, unknown> | null,
): OpenCodeThreadState => ({
	...createOpenCodeThreadState("ses_1"),
	session: session as never,
	messageOrder: messages.map((message) => message.id),
	messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
});

/*
 * `applyRevertVisibility` in the pnpm patch (plugins/kilo-ui/patches/
 * @assistant-ui__react-opencode@0.2.17.patch) filters reverted messages with
 * `message.id < revert.messageID` — plain string comparison.  This is safe
 * because the OpenCode server generates message IDs via
 * `Identifier.ascending("message")`: `msg_` + 12-char big-endian timestamp hex
 * + 14-char base62, fixed length and lexicographically monotonic
 * (`packages/opencode/src/id/id.ts`).  The TUI (`x.id < revert`,
 * `tui/src/routes/session/index.tsx:710`) and the VSCode webview
 * (`id < revert.messageID`, `context/session-queue.ts:62`) use the same
 * convention — this is deliberate ecosystem parity.
 *
 * The desktop renderer's own index-based `deriveRevertedUserRows` /
 * `useIsAfterPendingBoundary` diverge intentionally: they also serve
 * local/test runtimes with non-monotonic IDs.  A pending revert requires a
 * real OpenCode session, so non-monotonic IDs never reach the patch filter.
 */
describe("projectOpenCodeThreadMessages revert filtering", () => {
	it("hides the boundary message and everything after it while a revert is pending", () => {
		const state = stateWithMessages(
			[
				serverMessage("msg-1", "user", [textPart("msg-1_1", "first")]),
				serverMessage("msg-2", "assistant", [textPart("msg-2_1", "answer one")]),
				serverMessage("msg-3", "user", [textPart("msg-3_1", "second")]),
				serverMessage("msg-4", "assistant", [textPart("msg-4_1", "answer two")]),
			],
			{ id: "ses_1", revert: { messageID: "msg-3" } },
		);

		const projected = projectOpenCodeThreadMessages(state);

		expect(projected.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
	});

	it("keeps the boundary message with only the parts before the boundary part", () => {
		const state = stateWithMessages(
			[
				serverMessage("msg-1", "user", [textPart("msg-1_1", "first")]),
				serverMessage("msg-2", "assistant", [
					textPart("msg-2_1", "kept"),
					textPart("msg-2_2", "dropped"),
				]),
				serverMessage("msg-3", "user", [textPart("msg-3_1", "second")]),
			],
			{ id: "ses_1", revert: { messageID: "msg-2", partID: "msg-2_2" } },
		);

		const projected = projectOpenCodeThreadMessages(state);

		expect(projected.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
		expect(projected[1]?.content).toEqual([{ type: "text", text: "kept" }]);
	});

	it("projects every message when no revert is pending", () => {
		const messages = [
			serverMessage("msg-1", "user", [textPart("msg-1_1", "first")]),
			serverMessage("msg-2", "assistant", [textPart("msg-2_1", "answer one")]),
			serverMessage("msg-3", "user", [textPart("msg-3_1", "second")]),
		];

		expect(
			projectOpenCodeThreadMessages(stateWithMessages(messages, null)).map((message) => message.id),
		).toEqual(["msg-1", "msg-2", "msg-3"]);
		expect(
			projectOpenCodeThreadMessages(stateWithMessages(messages, { id: "ses_1" })).map(
				(message) => message.id,
			),
		).toEqual(["msg-1", "msg-2", "msg-3"]);
	});

	it("keeps pre-boundary messages and hides boundary and after with realistic monotonic ids", () => {
		// Realistic IDs: fixed-length, ascending 12-char hex prefix so
		// lexicographic order matches chronological order.
		const id1 = "msg_000000000001Aaaaaaaaaaaaa";
		const id2 = "msg_000000000002Baaaaaaaaaaaa";
		const id3 = "msg_000000000003Caaaaaaaaaaaa";
		const id4 = "msg_000000000004Daaaaaaaaaaaa";
		// `serverMessage` derives time.created via id.split("-")[1]; msg_ IDs
		// contain no "-", so all get the fallback 1 — createdAt ties are fine
		// because ordering comes from messageOrder.
		const state = stateWithMessages(
			[
				serverMessage(id1, "user", [textPart(`${id1}_1`, "first")]),
				serverMessage(id2, "assistant", [textPart(`${id2}_1`, "answer one")]),
				serverMessage(id3, "user", [textPart(`${id3}_1`, "second")]),
				serverMessage(id4, "assistant", [textPart(`${id4}_1`, "answer two")]),
			],
			{ id: "ses_1", revert: { messageID: id3 } },
		);

		const projected = projectOpenCodeThreadMessages(state);

		expect(projected.map((message) => message.id)).toEqual([id1, id2]);
	});

	it("documents reliance on lexicographically sortable ids (TUI/VSCode parity)", () => {
		// Intentional limitation: applyRevertVisibility uses string comparison,
		// so non-monotonic IDs yield wrong results.  With messageOrder
		// ["zzz-1", "aaa-2"] and boundary "aaa-2", the filter drops both:
		// "zzz-1" is not < "aaa-2" (false — "z" > "a"), and the boundary
		// itself with no partID returns [].  This mirrors — with the opposite
		// outcome — the index-based counterpart in checkpoint-revert.unit.test.ts
		// ("returns rows for ids at and after the boundary using messageOrder
		// index, not lexicographic comparison"), which returns only "aaa-2".
		// Ecosystem parity decision: keep lexicographic comparison to match kilo
		// TUI and VSCode webview.  If the patch is ever changed to index-based
		// filtering this test fails and forces a conscious decision.
		const state = stateWithMessages(
			[
				serverMessage("zzz-1", "user", [textPart("zzz-1_1", "first")]),
				serverMessage("aaa-2", "user", [textPart("aaa-2_1", "second")]),
			],
			{ id: "ses_1", revert: { messageID: "aaa-2" } },
		);

		const projected = projectOpenCodeThreadMessages(state);

		expect(projected).toHaveLength(0);
	});

	it("does not leak post-boundary assistant parts into earlier merged messages", () => {
		const state = stateWithMessages(
			[
				serverMessage("msg-1", "assistant", [textPart("msg-1_1", "answer one")]),
				serverMessage("msg-2", "user", [textPart("msg-2_1", "second")]),
				serverMessage("msg-3", "assistant", [textPart("msg-3_1", "answer two")]),
			],
			{ id: "ses_1", revert: { messageID: "msg-2" } },
		);

		const projected = projectOpenCodeThreadMessages(state);

		expect(projected).toHaveLength(1);
		expect(projected[0]?.id).toBe("msg-1");
		expect(projected[0]?.content).toEqual([{ type: "text", text: "answer one" }]);
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

const createController = (
	revert: ReturnType<typeof vi.fn>,
	unrevert: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ data: { id: "ses_1" } }),
) =>
	new OpenCodeThreadController(
		{ session: { revert, unrevert } } as never as OpencodeClient,
		() => ({
			subscribe: () => () => {},
		}),
		"ses_1",
	);

describe("OpenCodeThreadController.revert run state", () => {
	it("returns to idle after the server accepts the revert", async () => {
		const sessionData = { id: "ses_1", revert: { messageID: "user-2" } };
		const deferred = createDeferred<{ data: typeof sessionData }>();
		const controller = createController(vi.fn(() => deferred.promise));

		const revertPromise = controller.revert("user-2");
		expect(controller.getState().runState.type).toBe("reverting");

		deferred.resolve({ data: sessionData });
		await revertPromise;

		const state = controller.getState();
		expect(state.runState.type).toBe("idle");
		expect(state.sessionStatus?.type).toBe("idle");
	});

	it("applies the REST response session when data is present", async () => {
		const sessionData = { id: "ses_1", revert: { messageID: "user-2" } };
		const controller = createController(vi.fn().mockResolvedValue({ data: sessionData }));

		await controller.revert("user-2");

		expect((controller.getState().session as Record<string, unknown>)?.revert).toEqual({
			messageID: "user-2",
		});
		expect(controller.getState().runState.type).toBe("idle");
	});

	it("rejects with 'Revert returned no session' and moves to error state when response has no data", async () => {
		const controller = createController(vi.fn().mockResolvedValue({ data: undefined }));

		await expect(controller.revert("user-2")).rejects.toThrow("Revert returned no session");
		expect(controller.getState().runState.type).toBe("error");
	});

	it("moves to the error state when the revert request fails", async () => {
		const controller = createController(vi.fn().mockRejectedValue(new Error("revert rejected")));

		await expect(controller.revert("user-2")).rejects.toThrow("revert rejected");
		expect(controller.getState().runState.type).toBe("error");
	});
});

describe("OpenCodeThreadController.unrevert run state", () => {
	it("is reverting while the HTTP call is stalled", async () => {
		const deferred = createDeferred<{ data: unknown }>();
		const controller = createController(
			vi.fn().mockResolvedValue({ data: { id: "ses_1" } }),
			vi.fn(() => deferred.promise),
		);

		const unrevertPromise = controller.unrevert();
		expect(controller.getState().runState.type).toBe("reverting");

		deferred.resolve({ data: { id: "ses_1" } });
		await unrevertPromise;
	});

	it("applies the REST response session and returns to idle on success", async () => {
		const sessionData = { id: "ses_1" }; // revert cleared
		const controller = createController(
			vi.fn().mockResolvedValue({ data: undefined }),
			vi.fn().mockResolvedValue({ data: sessionData }),
		);

		await controller.unrevert();

		expect(controller.getState().session).toEqual(sessionData);
		expect(controller.getState().runState.type).toBe("idle");
		expect(controller.getState().sessionStatus?.type).toBe("idle");
	});

	it("rejects with 'Redo returned no session' and moves to error state when response has no data", async () => {
		const controller = createController(
			vi.fn().mockResolvedValue({ data: { id: "ses_1" } }),
			vi.fn().mockResolvedValue({ data: undefined }),
		);

		await expect(controller.unrevert()).rejects.toThrow("Redo returned no session");
		expect(controller.getState().runState.type).toBe("error");
	});

	it("moves to the error state and rethrows when the unrevert request fails", async () => {
		const controller = createController(
			vi.fn().mockResolvedValue({ data: undefined }),
			vi.fn().mockRejectedValue(new Error("unrevert rejected")),
		);

		await expect(controller.unrevert()).rejects.toThrow("unrevert rejected");
		expect(controller.getState().runState.type).toBe("error");
	});
});
