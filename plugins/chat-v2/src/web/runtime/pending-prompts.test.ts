import type { KiloClient, OpenCodeServerEvent } from "@kilo-desktop/react-opencode-v2";
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

function clientWith(permissions: Promise<unknown>, forms: Promise<unknown>) {
	const permissionList = vi.fn(() => permissions);
	const formList = vi.fn(() => forms);
	const client = {
		permission: { list: permissionList },
		session: { form: { list: formList } },
	} as unknown as KiloClient;
	return { client, permissionList, formList };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const asked = (events: OpenCodeServerEvent[]) =>
	events
		.filter((event) => event.type === "permission.asked")
		.map((event) => event.properties["id"]);

describe("withPendingPrompts", () => {
	it("replays each chat's pending permissions and forms as the Kilo v2 events that ask them", async () => {
		const { source } = liveSource();
		const permission = { id: "per_1", sessionID: "ses_1", action: "shell", resources: [] };
		const form = { id: "frm_1", sessionID: "ses_1", title: "Q", fields: [] };
		const { client, permissionList, formList } = clientWith(
			Promise.resolve([permission]),
			Promise.resolve([form]),
		);
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [["ses_1", client]]).subscribe((event) => events.push(event));
		await settle();

		expect(permissionList).toHaveBeenCalledWith({ sessionID: "ses_1" });
		expect(formList).toHaveBeenCalledWith({ sessionID: "ses_1" });
		expect(
			events.map(({ type, sessionId, properties }) => ({ type, sessionId, properties })),
		).toEqual([
			{ type: "permission.asked", sessionId: "ses_1", properties: permission },
			{ type: "form.created", sessionId: "ses_1", properties: { form } },
		]);
	});

	it("doesn't bring back a prompt answered while the list was being read", async () => {
		const { source, emit } = liveSource();
		const permissions = deferred<unknown>();
		const forms = deferred<unknown>();
		const { client } = clientWith(permissions.promise, forms.promise);
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [["ses_1", client]]).subscribe((event) => events.push(event));
		emit("permission.replied", { requestID: "per_1", reply: "once" });
		emit("form.cancelled", { id: "frm_1", sessionID: "ses_1" });
		permissions.resolve([{ id: "per_1", sessionID: "ses_1" }]);
		forms.resolve([{ id: "frm_1", sessionID: "ses_1", fields: [] }]);
		await settle();

		expect(events.map((event) => event.type)).toEqual(["permission.replied", "form.cancelled"]);
	});

	it("replays nothing to a subscriber that already let go", async () => {
		const { source } = liveSource();
		const permissions = deferred<unknown>();
		const { client } = clientWith(permissions.promise, Promise.resolve([]));
		const events: OpenCodeServerEvent[] = [];

		const unsubscribe = withPendingPrompts(source, () => [["ses_1", client]]).subscribe((event) =>
			events.push(event),
		);
		unsubscribe();
		permissions.resolve([{ id: "per_1", sessionID: "ses_1" }]);
		await settle();

		expect(asked(events)).toEqual([]);
		expect(events).toEqual([]);
	});

	it("still passes live events through when the pending lists can't be read", async () => {
		const { source, emit } = liveSource();
		const { client } = clientWith(
			Promise.reject(new Error("offline")),
			Promise.reject(new Error("offline")),
		);
		const events: OpenCodeServerEvent[] = [];

		withPendingPrompts(source, () => [["ses_1", client]]).subscribe((event) => events.push(event));
		emit("session.idle", { sessionID: "ses_1" });
		await settle();

		expect(events.map((event) => event.type)).toEqual(["session.idle"]);
	});
});
