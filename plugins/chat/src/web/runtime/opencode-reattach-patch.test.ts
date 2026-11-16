import { OpenCodeThreadController, type OpenCodeServerEvent } from "@assistant-ui/react-opencode";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

/*
 * Reattaching in the pnpm patch (plugins/chat/patches/
 * @assistant-ui__react-opencode@0.2.17.patch): a thread whose listeners all
 * left (a hidden Activity, a tab switched away) only watches whether anything
 * for it arrived. Coming back refreshes its history only if something did,
 * so showing a kept chat again doesn't fetch and rebuild its whole history.
 */

type Listener = (event: OpenCodeServerEvent) => void;

function setup() {
	const listeners = new Set<Listener>();
	const messages = vi.fn().mockResolvedValue({ data: [] });
	const client = {
		session: {
			get: vi.fn().mockResolvedValue({ data: { id: "ses_1" } }),
			messages,
			status: vi.fn().mockResolvedValue({ data: {} }),
		},
	} as never as OpencodeClient;
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
	const emit = (event: Partial<OpenCodeServerEvent>) => {
		for (const listener of [...listeners]) listener(event as OpenCodeServerEvent);
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

		emit({ type: "message.part.updated", sessionId: "ses_1", properties: {} } as never);
		controller.subscribe(() => undefined);
		await settle();

		expect(messages).toHaveBeenCalledOnce();
	});

	it("refreshes after a stream reconnect, which may have dropped events", async () => {
		const { controller, messages, emit } = await loadedAndDetached();

		emit({ type: "stream.reconnected" } as never);
		controller.subscribe(() => undefined);
		await settle();

		expect(messages).toHaveBeenCalledOnce();
	});

	it("ignores other threads' events, and stops watching once it knows", async () => {
		const { controller, emit, listeners } = await loadedAndDetached();

		emit({ type: "message.part.updated", sessionId: "ses_other", properties: {} } as never);
		expect(listeners.size).toBe(1);
		emit({ type: "message.part.updated", sessionId: "ses_1", properties: {} } as never);
		expect(listeners.size).toBe(0);

		controller.dispose();
		expect(listeners.size).toBe(0);
	});
});
