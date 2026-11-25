import { describe, expect, it, vi } from "vitest";

import { OpenCodeThreadController } from "./OpenCodeThreadController";
import {
	createFakeClient,
	createFakeEventSource,
	MODEL,
	serverEvent,
	SESSION_ID,
	settleMicrotasks,
	streamReconnected,
	user,
} from "./testUtils";

/*
 * Reattaching (requirement R4 in docs/kilo-v2.md): a thread whose listeners
 * all left (a hidden Activity, a tab switched away) only watches whether
 * anything for it arrived; coming back reloads its history only if
 * something did. A running thread instead stays attached until its run
 * ends: streamed text exists only as deltas, so a reload mid-run loses it.
 */

async function loadedAndDetached() {
	const fake = createFakeClient();
	fake.transcripts.set(SESSION_ID, [user("msg_1")]);
	const events = createFakeEventSource();
	const controller = new OpenCodeThreadController(fake.client, () => events, SESSION_ID);
	const unsubscribe = controller.subscribe(() => undefined);
	await controller.load();
	unsubscribe();
	await settleMicrotasks();
	fake.message.list.mockClear();
	return { fake, events, controller };
}

const stepStarted = (assistantMessageID: string) =>
	serverEvent("session.step.started", {
		assistantMessageID,
		agent: "code",
		model: MODEL,
		started: 1,
	});

describe("OpenCodeThreadController reattaching", () => {
	it("doesn't fetch the history again when nothing arrived while no one listened", async () => {
		const { fake, controller } = await loadedAndDetached();

		controller.subscribe(() => undefined);
		await settleMicrotasks();

		expect(fake.message.list).not.toHaveBeenCalled();
		expect(controller.getState().loadState.type).toBe("ready");
	});

	it("reloads the history when an event for the thread arrived while no one listened", async () => {
		const { fake, events, controller } = await loadedAndDetached();

		events.emit(serverEvent("session.renamed", { title: "Elsewhere" }));
		controller.subscribe(() => undefined);

		await vi.waitFor(() => expect(fake.message.list).toHaveBeenCalledOnce());
	});

	it("reloads after a stream reconnect, which may have dropped events", async () => {
		const { fake, events, controller } = await loadedAndDetached();

		events.emit(streamReconnected);
		controller.subscribe(() => undefined);

		await vi.waitFor(() => expect(fake.message.list).toHaveBeenCalledOnce());
	});

	it("ignores other threads' events, and stops watching once it knows", async () => {
		const { events, controller } = await loadedAndDetached();

		events.emit(serverEvent("session.renamed", { sessionID: "ses_other", title: "x" }));
		expect(events.listeners.size).toBe(1);
		events.emit(serverEvent("session.renamed", { title: "y" }));
		expect(events.listeners.size).toBe(0);

		controller.dispose();
		expect(events.listeners.size).toBe(0);
	});

	it("keeps applying a running thread's events after its last listener leaves", async () => {
		const { events, controller } = await loadedAndDetached();
		const unsubscribe = controller.subscribe(() => undefined);
		events.emit(serverEvent("session.execution.started"));

		unsubscribe();
		expect(controller.isAttachedToEvents()).toBe(true);

		events.emit(stepStarted("msg_2"));
		expect(controller.getState().messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
	});

	it("lets go once the hidden run ends, without counting its last event as missed", async () => {
		const { fake, events, controller } = await loadedAndDetached();
		const unsubscribe = controller.subscribe(() => undefined);
		events.emit(serverEvent("session.execution.started"));
		unsubscribe();

		events.emit(serverEvent("session.execution.succeeded"));
		expect(controller.isAttachedToEvents()).toBe(false);
		expect(controller.getState().running).toBe(false);

		controller.subscribe(() => undefined);
		await settleMicrotasks();
		expect(fake.message.list).not.toHaveBeenCalled();
	});

	it("keeps a disposed running thread attached until its run ends, then lets go entirely", async () => {
		const { events, controller } = await loadedAndDetached();
		controller.subscribe(() => undefined);
		events.emit(serverEvent("session.execution.started"));

		controller.dispose();
		expect(controller.isAttachedToEvents()).toBe(true);

		events.emit(serverEvent("session.execution.succeeded"));
		expect(controller.isAttachedToEvents()).toBe(false);
		expect(events.listeners.size).toBe(0);
	});
});
