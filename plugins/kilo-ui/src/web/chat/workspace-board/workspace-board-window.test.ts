import { describe, expect, it } from "vitest";

import { parseOpenSessionRequest } from "./workspace-board-window.js";

describe("parseOpenSessionRequest", () => {
	it("accepts a request naming a session", () => {
		expect(parseOpenSessionRequest({ sessionId: "ses_1" })).toEqual({ sessionId: "ses_1" });
	});

	it.each([
		["nothing", undefined],
		["a bare string", "ses_1"],
		["no session id", {}],
		["an empty session id", { sessionId: "" }],
		["a non-string session id", { sessionId: 42 }],
	])("ignores %s from another window", (_case, payload) => {
		expect(parseOpenSessionRequest(payload)).toBeNull();
	});
});
