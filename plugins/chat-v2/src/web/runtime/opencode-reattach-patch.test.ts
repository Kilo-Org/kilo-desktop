import {
	OpenCodeThreadController,
	STREAM_RECONNECTED_EVENT_TYPE,
	type KiloClient,
	type OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it, vi } from "vitest";

import { streamEvent } from "../../test/stream-events";

/*
 * Reattaching in kilo.chat's react-opencode fork
 * (plugins/chat-v2/react-opencode): a thread whose listeners all
 * left (a hidden Activity, a tab switched away) only watches whether anything
 * for it arrived. Coming back refreshes its history only if something did,
 * so showing a kept chat again doesn't fetch and rebuild its whole history.
 */

type Listener = (event: OpenCodeServerEvent) => void;

function setup() {
	const listeners = new Set<Listener>();
	const messages = vi.fn().mockResolvedValue({ data: [], cursor: {} });
	const client = {
		session: {
			get: vi.fn().mockResolvedValue({ id: "ses_1", location: { directory: "/p" }, time: {} }),
			active: vi.fn().mockResolvedValue({}),
		},
		message: { list: messages },
	} as never as KiloClient;
	const controller = new OpenCodeThreadController(
		client,
		() => ({
			subscribe: (listener: Listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		}),
		"ses_1",
	);
	const emit = (event: OpenCodeServerEvent) => {
		for (const listener of [...listeners]) listener(event);
	};
	return { controller, messages, emit, listeners };
}

async function loadedAndDetached() {
	const context = setup();
	const unsubscribe = context.controller.subscribe(() => undefined);
	await context.controller.load();
	unsubscribe();
	context.messages.mockClear();
	return context;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OpenCodeThreadController reattaching", () => {
	it("doesn't fetch the history again when nothing arrived while no one listened", async () => {
		const { controller, messages } = await loadedAndDetached();

		controller.subscribe(() => undefined);
		await settle();

		expect(messages).not.toHaveBeenCalled();
		expect(controller.getState().loadState.type).toBe("ready");
	});

	it("refreshes the history when an event for the thread arrived while no one listened", async () => {
		const { controller, messages, emit } = await loadedAndDetached();

		emit(streamEvent("session.renamed", { sessionID: "ses_1", title: "Renamed" }));
		controller.subscribe(() => undefined);
		await settle();

		expect(messages).toHaveBeenCalledOnce();
	});

	it("refreshes after a stream reconnect, which may have dropped events", async () => {
		const { controller, messages, emit } = await loadedAndDetached();

		emit({ type: STREAM_RECONNECTED_EVENT_TYPE });
		controller.subscribe(() => undefined);
		await settle();

		expect(messages).toHaveBeenCalledOnce();
	});

	it("ignores other threads' events, and stops watching once it knows", async () => {
		const { controller, emit, listeners } = await loadedAndDetached();

		emit(streamEvent("session.renamed", { sessionID: "ses_other", title: "Renamed" }));
		expect(listeners.size).toBe(1);
		emit(streamEvent("session.renamed", { sessionID: "ses_1", title: "Renamed" }));
		expect(listeners.size).toBe(0);

		controller.dispose();
		expect(listeners.size).toBe(0);
	});
});
