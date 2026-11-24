import type { OpenCodeServerEvent } from "@kilo-desktop/react-opencode-v2";
import type { KiloClient } from "@kilocode/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import { withPendingPrompts } from "./pending-prompts";

function liveSource() {
	const listeners = new Set<(event: OpenCodeServerEvent) => void>();
	return {
		emit: (type: string, properties: Record<string, unknown>) => {
			for (const listener of listeners) {
				listener({ type, properties, sessionId: undefined, raw: undefined });
			}
		},
		source: {
			subscribe: (listener: (event: OpenCodeServerEvent) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose: vi.fn(),
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function clientWith(permissions: Promise<unknown>, questions: Promise<unknown>): KiloClient {
	return {
		permission: { list: () => permissions },
		question: { list: () => questions },
	} as unknown as KiloClient;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const asked = (events: OpenCodeServerEvent[]) =>
	events.filter((event) => event.type.endsWith(".asked")).map((event) => event.properties["id"]);

describe("withPendingPrompts", () => {
	it("replays pending permissions and questions as asked events for their sessions", async () => {
		const { source } = liveSource();
		const client = clientWith(
			Promise.resolve({ data: [{ id: "per_1", sessionID: "ses_1" }] }),
			Promise.resolve({ data: [{ id: "que_1", sessionID: "ses_2" }] }),
		);
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [client]).subscribe((event) => events.push(event));
		await settle();

		expect(events.map(({ type, sessionId }) => ({ type, sessionId }))).toEqual([
			{ type: "permission.asked", sessionId: "ses_1" },
			{ type: "question.asked", sessionId: "ses_2" },
		]);
	});

	it("doesn't bring back a prompt answered while the list was being read", async () => {
		const { source, emit } = liveSource();
		const permissions = deferred<unknown>();
		const client = clientWith(permissions.promise, Promise.resolve({ data: [] }));
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [client]).subscribe((event) => events.push(event));
		emit("permission.replied", { requestID: "per_1", reply: "once" });
		permissions.resolve({ data: [{ id: "per_1", sessionID: "ses_1" }] });
		await settle();

		expect(asked(events)).toEqual([]);
	});

	it("replays nothing to a subscriber that already let go", async () => {
		const { source } = liveSource();
		const permissions = deferred<unknown>();
		const client = clientWith(permissions.promise, Promise.resolve({ data: [] }));
		const events: OpenCodeServerEvent[] = [];

		const unsubscribe = withPendingPrompts(source, () => [client]).subscribe((event) =>
			events.push(event),
		);
		unsubscribe();
		permissions.resolve({ data: [{ id: "per_1", sessionID: "ses_1" }] });
		await settle();

		expect(events).toEqual([]);
	});

	it("still passes live events through when the pending lists can't be read", async () => {
		const { source, emit } = liveSource();
		const client = clientWith(
			Promise.reject(new Error("offline")),
			Promise.reject(new Error("offline")),
		);
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [client]).subscribe((event) => events.push(event));
		emit("session.idle", { sessionID: "ses_1" });
		await settle();

		expect(events.map((event) => event.type)).toEqual(["session.idle"]);
	});
});
