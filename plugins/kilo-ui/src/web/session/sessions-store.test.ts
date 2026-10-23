import { describe, expect, it } from "vitest";

import { createSessionsStore } from "./sessions-store.js";

describe("sessions store", () => {
	it("knows no chat's session until the first list arrives", () => {
		const store = createSessionsStore();
		expect(store.getState().loaded).toBe(false);

		store.replaceAll([
			{ id: "wses_a", chatIds: ["ses_1"] },
			{ id: "wses_b", chatIds: [] },
		]);

		expect(store.getState().loaded).toBe(true);
		expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_a" });
		expect(store.getState().sessions.wses_b).toEqual({ id: "wses_b", chatIds: [] });
	});

	it("keeps an optimistic link across a stale list until it settles", () => {
		const store = createSessionsStore([]);
		store.linkChat("wses_draft", "ses_1");

		store.replaceAll([]);
		expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_draft" });
		expect(store.getState().sessions.wses_draft?.chatIds).toEqual(["ses_1"]);

		store.settleLink("ses_1");
		expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_draft" });
		store.replaceAll([]);
		expect(store.getState().sessionIdByChat).toEqual({});
	});

	it("moves an optimistically relinked chat out of its old session", () => {
		const store = createSessionsStore([{ id: "wses_a", chatIds: ["ses_1"] }]);
		store.linkChat("wses_b", "ses_1");
		expect(store.getState().sessions.wses_a?.chatIds).toEqual([]);
		expect(store.getState().sessionIdByChat).toEqual({ ses_1: "wses_b" });
	});

	it("drops a session with its chat links", () => {
		const store = createSessionsStore([{ id: "wses_a", chatIds: ["ses_1"] }]);
		store.dropSession("wses_a");
		expect(store.getState().sessions).toEqual({});
		expect(store.getState().sessionIdByChat).toEqual({});
	});
});
