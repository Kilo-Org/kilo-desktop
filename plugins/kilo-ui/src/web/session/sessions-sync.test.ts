import { describe, expect, it, vi } from "vitest";

import type { SessionsService } from "../../contracts/sessions/schemas.js";
import { createSessionsStore } from "./sessions-store.js";
import { deletedChatIdOf, startSessionsSync } from "./sessions-sync.js";
import { createFakeSessionsBackend } from "./test-helpers.js";

function fakeMain(initial: Record<string, string> = {}) {
	const backend = createFakeSessionsBackend();
	for (const [kiloSessionId, sessionId] of Object.entries(initial)) {
		backend.link(sessionId, kiloSessionId);
	}
	const listeners = new Set<(payload: unknown) => void>();
	backend.announceWith(() => {
		for (const listener of listeners) listener(undefined);
	});
	const client = {
		"sessions.list": vi.fn(backend.handlers["sessions.list"]),
		"sessions.attachChat": vi.fn(backend.handlers["sessions.attachChat"]),
		"sessions.adoptChats": vi.fn(backend.handlers["sessions.adoptChats"]),
		"sessions.delete": vi.fn(backend.handlers["sessions.delete"]),
		"sessions.detachChat": vi.fn(backend.handlers["sessions.detachChat"]),
	} satisfies SessionsService;
	const events = {
		on: (_event: string, listener: (payload: unknown) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return { backend, client, events };
}

describe("sessions sync", () => {
	it("loads the saved sessions and follows changes", async () => {
		const main = fakeMain({ ses_1: "wses_a" });
		const store = createSessionsStore();
		startSessionsSync({ store, ...main });

		await vi.waitFor(() => expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_a" }));

		main.backend.link("wses_b", "ses_2");
		await vi.waitFor(() =>
			expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_a", ses_2: "wses_b" }),
		);
	});

	it("links a chat it creates at once and saves its draft session", async () => {
		const main = fakeMain();
		const store = createSessionsStore([]);
		const sync = startSessionsSync({ store, ...main });

		sync.attachChat("wses_draft", "ses_1");

		expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_draft" });
		expect(main.client["sessions.attachChat"]).toHaveBeenCalledWith({
			sessionId: "wses_draft",
			kiloSessionId: "ses_1",
		});
	});

	it("adopts only chats no session owns, moving their state before showing the links", async () => {
		const main = fakeMain({ ses_1: "wses_a" });
		const store = createSessionsStore();
		const seen: unknown[] = [];
		const sync = startSessionsSync({
			store,
			...main,
			onAdopted: (adopted) => {
				seen.push({ adopted, linked: { ...store.getState().sessionIdByChat } });
			},
		});
		await vi.waitFor(() => expect(store.getState().loaded).toBe(true));

		sync.adoptChats(["ses_1", "ses_2", "ses_2"]);

		await vi.waitFor(() => expect(store.getState().sessionIdByChat.ses_2).toBe("wses_adopted_1"));
		expect(main.client["sessions.adoptChats"]).toHaveBeenCalledWith({ kiloSessionIds: ["ses_2"] });
		expect(seen).toEqual([{ adopted: { ses_2: "wses_adopted_1" }, linked: { ses_1: "wses_a" } }]);
	});

	it("drops a deleted session at once", async () => {
		const main = fakeMain({ ses_1: "wses_a" });
		const store = createSessionsStore([{ id: "wses_a", chatIds: ["ses_1"] }]);
		const sync = startSessionsSync({ store, ...main });

		sync.deleteSession("wses_a");

		expect(store.getState().sessionIdByChat).toEqual({});
		expect(main.client["sessions.delete"]).toHaveBeenCalledWith({ sessionId: "wses_a" });
	});
});

describe("deletedChatIdOf", () => {
	it("reads the deleted chat from either event shape", () => {
		expect(
			deletedChatIdOf({ type: "session.deleted", properties: { info: { id: "ses_1" } } }),
		).toBe("ses_1");
		expect(deletedChatIdOf({ type: "session.deleted", properties: { sessionID: "ses_2" } })).toBe(
			"ses_2",
		);
		expect(deletedChatIdOf({ type: "session.updated", properties: { sessionID: "ses_2" } })).toBe(
			undefined,
		);
	});
});
