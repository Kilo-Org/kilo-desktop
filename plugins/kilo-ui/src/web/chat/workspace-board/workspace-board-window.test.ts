import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import {
	parseOpenSessionRequest,
	requestMainWindowChatAction,
	WORKSPACE_BOARD_CHAT_ACTION_EVENT,
	WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT,
} from "./workspace-board-window.js";

afterEach(() => {
	vi.useRealTimers();
});

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

describe("requestMainWindowChatAction", () => {
	it("settles with its own result only, ignoring others' and malformed ones", async () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		let requestId = "";
		sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_CHAT_ACTION_EVENT}`, (payload) => {
			expect(payload).toMatchObject({ action: "archive", sessionId: "ses-1" });
			requestId = (payload as { requestId: string }).requestId;
		});
		const request = requestMainWindowChatAction(sdk.events, {
			action: "archive",
			sessionId: "ses-1",
		});
		const settled = vi.fn();
		request.then(settled, settled);

		sdk.events.emit(WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT, { requestId: "someone-else" });
		sdk.events.emit(WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT, { requestId, error: 42 });
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();

		sdk.events.emit(WORKSPACE_BOARD_CHAT_ACTION_RESULT_EVENT, { requestId, error: "Server down" });
		await expect(request).rejects.toThrow("Server down");
	});

	it("gives up when the main window never answers", async () => {
		vi.useFakeTimers();
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const request = requestMainWindowChatAction(sdk.events, {
			action: "delete",
			sessionId: "ses-1",
		});
		const settled = expect(request).rejects.toThrow("The main window did not respond.");

		await vi.advanceTimersByTimeAsync(30_000);

		await settled;
	});
});
