import type { OpenCodeServerEvent } from "@kilo-desktop/react-opencode";
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

	it("settles a prompt answered while no thread was listening when a thread subscribes", async () => {
		const { source, emit } = liveSource();
		const lists = { permissions: [] as unknown[] };
		const client = {
			permission: { list: async () => ({ data: lists.permissions }) },
			question: { list: async () => ({ data: [] }) },
		} as unknown as KiloClient;
		const pending = withPendingPrompts(source, () => [client]);

		const stop = pending.subscribe(() => undefined);
		await settle();
		emit("permission.asked", { id: "per_1", sessionID: "ses_1" });
		stop();
		const events: OpenCodeServerEvent[] = [];
		pending.subscribe((event) => events.push(event));
		await settle();

		expect(events.map(({ type, sessionId, properties }) => [type, sessionId, properties])).toEqual([
			["permission.replied", "ses_1", { sessionID: "ses_1", requestID: "per_1", reply: "once" }],
		]);
	});

	it("settles a prompt the server dropped across a reconnect", async () => {
		const { source, emit } = liveSource();
		const client = clientWith(Promise.resolve({ data: [] }), Promise.resolve({ data: [] }));
		const events: OpenCodeServerEvent[] = [];
		withPendingPrompts(source, () => [client]).subscribe((event) => events.push(event));
		await settle();

		emit("question.asked", { id: "que_1", sessionID: "ses_1" });
		emit("stream.reconnected", {});
		await settle();

		expect(events.map((event) => event.type)).toEqual([
			"question.asked",
			"stream.reconnected",
			"question.rejected",
		]);
	});

	it("doesn't bring back a prompt another read settled while it was in flight", async () => {
		const { source, emit } = liveSource();
		const reads = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
		let next = 0;
		const client = {
			permission: { list: () => reads[next++]!.promise },
			question: { list: async () => ({ data: [] }) },
		} as unknown as KiloClient;
		const pending = withPendingPrompts(source, () => [client]);

		pending.subscribe(() => undefined);
		reads[0]!.resolve({ data: [] });
		await settle();
		emit("permission.asked", { id: "per_1", sessionID: "ses_1" });
		pending.subscribe(() => undefined);
		const events: OpenCodeServerEvent[] = [];
		pending.subscribe((event) => events.push(event));
		reads[1]!.resolve({ data: [] });
		await settle();
		reads[2]!.resolve({ data: [{ id: "per_1", sessionID: "ses_1" }] });
		await settle();

		expect(events.map((event) => event.type)).toEqual(["permission.replied"]);
	});

	it("settles nothing when a pending list can't be read", async () => {
		const { source, emit } = liveSource();
		const client = clientWith(Promise.reject(new Error("offline")), Promise.resolve({ data: [] }));
		const events: OpenCodeServerEvent[] = [];
		withPendingPrompts(source, () => [client]).subscribe((event) => events.push(event));
		emit("permission.asked", { id: "per_1", sessionID: "ses_1" });
		emit("stream.reconnected", {});
		await settle();

		expect(events.map((event) => event.type)).toEqual(["permission.asked", "stream.reconnected"]);
	});

	it("doesn't settle a prompt asked while the list was being read", async () => {
		const { source, emit } = liveSource();
		const permissions = deferred<unknown>();
		const client = clientWith(permissions.promise, Promise.resolve({ data: [] }));
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [client]).subscribe((event) => events.push(event));
		emit("permission.asked", { id: "per_1", sessionID: "ses_1" });
		permissions.resolve({ data: [] });
		await settle();

		expect(events.map((event) => event.type)).toEqual(["permission.asked"]);
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
