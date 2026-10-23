import { afterEach, describe, expect, it } from "vitest";

import {
	draftSessionIdOf,
	sessionIdOfThread,
	setDraftSessionIdMinterForTests,
} from "./session-identity.js";

afterEach(() => setDraftSessionIdMinterForTests());

describe("draftSessionIdOf", () => {
	it("mints one id per draft and keeps it", () => {
		const id = draftSessionIdOf("__LOCALID_a");
		expect(id).toMatch(/^wses_/u);
		expect(draftSessionIdOf("__LOCALID_a")).toBe(id);
		expect(draftSessionIdOf("__LOCALID_b")).not.toBe(id);
	});
});

describe("sessionIdOfThread", () => {
	it("gives a draft its minted session id, not its thread id", () => {
		const id = sessionIdOfThread({ remoteId: undefined, localThreadId: "__LOCALID_a" }, {});
		expect(id).toBe(draftSessionIdOf("__LOCALID_a"));
		expect(id).not.toBe("__LOCALID_a");
	});

	it("resolves a thread with a chat through the session the chat is linked to", () => {
		expect(
			sessionIdOfThread({ remoteId: "ses_1", localThreadId: "ses_1" }, { ses_1: "wses_a" }),
		).toBe("wses_a");
	});

	it("keeps a draft's session id while its new chat's link is on its way", () => {
		const draftId = draftSessionIdOf("__LOCALID_a");
		expect(sessionIdOfThread({ remoteId: "ses_1", localThreadId: "__LOCALID_a" }, {})).toBe(
			draftId,
		);
	});

	it("knows no session for a chat no session owns yet", () => {
		expect(sessionIdOfThread({ remoteId: "ses_1", localThreadId: "ses_1" }, {})).toBeUndefined();
	});
});
