import { describe, expect, it } from "vitest";

import { shouldShowChatCanvas } from "./chat-canvas-visibility.js";

describe("shouldShowChatCanvas", () => {
	it("keeps a new empty chat off the pane canvas", () => {
		expect(
			shouldShowChatCanvas({
				hasMessages: false,
				hasExtraPanes: false,
				remoteId: undefined,
				status: "new",
			}),
		).toBe(false);
	});

	it("does not reopen a workspace canvas when New leaves leftover session panes", () => {
		expect(
			shouldShowChatCanvas({
				hasMessages: false,
				hasExtraPanes: true,
				remoteId: "session-1",
				status: "new",
			}),
		).toBe(false);
	});

	it("shows the canvas after a chat has messages", () => {
		expect(
			shouldShowChatCanvas({
				hasMessages: true,
				hasExtraPanes: false,
				remoteId: undefined,
				status: "regular",
			}),
		).toBe(true);
	});

	it("shows the canvas for an existing session while messages load", () => {
		expect(
			shouldShowChatCanvas({
				hasMessages: false,
				hasExtraPanes: false,
				remoteId: "session-1",
				status: "regular",
			}),
		).toBe(true);
	});

	it("shows the canvas when a draft has extra panes after leaving new status", () => {
		expect(
			shouldShowChatCanvas({
				hasMessages: false,
				hasExtraPanes: true,
				remoteId: undefined,
				status: "regular",
			}),
		).toBe(true);
	});
});
