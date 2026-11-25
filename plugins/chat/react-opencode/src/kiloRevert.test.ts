import type { SessionRevert } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import { projectOpenCodeThreadMessages, visibleMessages } from "./openCodeMessageProjection";
import { OpenCodeThreadController } from "./OpenCodeThreadController";
import {
	assistant,
	createDeferred,
	createFakeClient,
	createFakeEventSource,
	serverEvent,
	session,
	SESSION_ID,
	text,
	threadState,
	user,
} from "./testUtils";

/*
 * Revert (requirement R5 in docs/kilo-v2.md): a staged revert
 * (`session.revert.stage`) hides its boundary message and everything after
 * it until it is cleared (`session.revert.clear`) or committed by the next
 * prompt; the controller applies the staged revert from the reply.
 */

const transcript = [
	user("msg_1", "first"),
	assistant("msg_2", [text("answer one")]),
	user("msg_3", "second"),
	assistant("msg_4", [text("answer two")]),
];

const projectedIds = (revert?: SessionRevert) =>
	projectOpenCodeThreadMessages(
		threadState(transcript, { session: session(SESSION_ID, revert ? { revert } : {}) }),
	).map((message) => message.id);

describe("projectOpenCodeThreadMessages revert filtering", () => {
	it("hides the boundary message and everything after it while a revert is staged", () => {
		expect(projectedIds({ messageID: "msg_3" })).toEqual(["msg_1", "msg_2"]);
	});

	it("projects every message when no revert is staged", () => {
		expect(projectedIds()).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
		expect(
			projectOpenCodeThreadMessages(threadState(transcript, { session: null })).map(
				(message) => message.id,
			),
		).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
	});

	it("cuts by transcript position, not by id order", () => {
		const state = threadState([user("msg_z"), user("msg_a"), user("msg_m")], {
			session: session(SESSION_ID, { revert: { messageID: "msg_a" } }),
		});

		expect(visibleMessages(state).map((message) => message.id)).toEqual(["msg_z"]);
	});

	it("hides nothing for a boundary the transcript doesn't hold (the loader loads up to it)", () => {
		expect(projectedIds({ messageID: "msg_missing" })).toEqual([
			"msg_1",
			"msg_2",
			"msg_3",
			"msg_4",
		]);
	});

	it("does not leak post-boundary steps into the turn before it", () => {
		const state = threadState(
			[assistant("msg_1", [text("answer one")]), assistant("msg_2", [text("hidden")])],
			{ session: session(SESSION_ID, { revert: { messageID: "msg_2" } }) },
		);

		const projected = projectOpenCodeThreadMessages(state);

		expect(projected).toHaveLength(1);
		const content = projected[0]?.content;
		expect(
			Array.isArray(content) ? content.filter((part) => part.type === "text") : content,
		).toEqual([{ type: "text", text: "answer one" }]);
	});
});

async function loadedController() {
	const fake = createFakeClient();
	fake.transcripts.set(SESSION_ID, transcript);
	const events = createFakeEventSource();
	const controller = new OpenCodeThreadController(fake.client, () => events, SESSION_ID);
	await controller.load();
	return { fake, events, controller };
}

const shownIds = (controller: OpenCodeThreadController) =>
	projectOpenCodeThreadMessages(controller.getState()).map((message) => message.id);

describe("OpenCodeThreadController.revert", () => {
	it("is reverting while the stage request is in flight, then applies the staged revert", async () => {
		const { fake, controller } = await loadedController();
		const reply = createDeferred<SessionRevert>();
		fake.session.revert.stage.mockReturnValueOnce(reply.promise);

		const reverting = controller.revert("msg_3");
		expect(controller.getState().runState.type).toBe("reverting");

		reply.resolve({ messageID: "msg_3", files: [] });
		await reverting;

		expect(fake.session.revert.stage).toHaveBeenCalledWith({
			sessionID: SESSION_ID,
			messageID: "msg_3",
		});
		expect(controller.getState().session?.revert).toEqual({ messageID: "msg_3", files: [] });
		expect(controller.getState()).toMatchObject({ running: false, runState: { type: "idle" } });
		expect(shownIds(controller)).toEqual(["msg_1", "msg_2"]);
	});

	it("moves to the error state and rethrows when staging fails", async () => {
		const { fake, controller } = await loadedController();
		fake.session.revert.stage.mockRejectedValueOnce(new Error("revert rejected"));

		await expect(controller.revert("msg_3")).rejects.toThrow("revert rejected");
		expect(controller.getState().runState.type).toBe("error");
		expect(controller.getState().session).not.toHaveProperty("revert");
	});

	it("follows a revert staged elsewhere", async () => {
		const { events, controller } = await loadedController();
		controller.subscribe(() => undefined);

		events.emit(serverEvent("session.revert.staged", { revert: { messageID: "msg_3" } }));

		expect(shownIds(controller)).toEqual(["msg_1", "msg_2"]);
	});
});

describe("OpenCodeThreadController.unrevert", () => {
	it("is reverting while the clear request is in flight, then shows everything again", async () => {
		const { fake, controller } = await loadedController();
		await controller.revert("msg_3");
		const reply = createDeferred<void>();
		fake.session.revert.clear.mockReturnValueOnce(reply.promise);

		const clearing = controller.unrevert();
		expect(controller.getState().runState.type).toBe("reverting");

		reply.resolve();
		await clearing;

		expect(fake.session.revert.clear).toHaveBeenCalledWith({ sessionID: SESSION_ID });
		expect(controller.getState().session).not.toHaveProperty("revert");
		expect(controller.getState().runState.type).toBe("idle");
		expect(shownIds(controller)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
	});

	it("moves to the error state and rethrows when clearing fails", async () => {
		const { fake, controller } = await loadedController();
		await controller.revert("msg_3");
		fake.session.revert.clear.mockRejectedValueOnce(new Error("unrevert rejected"));

		await expect(controller.unrevert()).rejects.toThrow("unrevert rejected");
		expect(controller.getState().runState.type).toBe("error");
		expect(controller.getState().session?.revert).toEqual({ messageID: "msg_3" });
	});

	it("follows a revert cleared elsewhere", async () => {
		const { events, controller } = await loadedController();
		await controller.revert("msg_3");
		controller.subscribe(() => undefined);

		events.emit(serverEvent("session.revert.cleared"));

		expect(shownIds(controller)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4"]);
	});
});
