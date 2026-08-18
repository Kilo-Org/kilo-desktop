import { describe, expect, it } from "vitest";

import {
	applySuggestionEvent,
	assistantWorkingIndicatorMode,
	isComposerPromptBusy,
	parseSuggestionRequest,
	pickPendingSuggestion,
	type KiloSuggestionEvent,
	type KiloSuggestionRequest,
} from "./kilo-suggestion-logic.js";

const request = (overrides?: Partial<KiloSuggestionRequest>): KiloSuggestionRequest => ({
	id: "sug-1",
	sessionID: "ses-1",
	text: "Run a local review?",
	actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
	...overrides,
});

const shown = (info: KiloSuggestionRequest): KiloSuggestionEvent => ({
	type: "suggestion.shown",
	properties: info,
});

describe("parseSuggestionRequest", () => {
	it("reads a shown-event payload", () => {
		expect(
			parseSuggestionRequest({
				id: "sug-1",
				sessionID: "ses-1",
				text: "Run a local review?",
				actions: [
					{
						label: "Start review",
						description: "Review uncommitted changes",
						prompt: "/local-review-uncommitted",
					},
				],
				blocking: false,
				tool: { messageID: "msg-1", callID: "call-1" },
			}),
		).toEqual({
			id: "sug-1",
			sessionID: "ses-1",
			text: "Run a local review?",
			actions: [
				{
					label: "Start review",
					description: "Review uncommitted changes",
					prompt: "/local-review-uncommitted",
				},
			],
			blocking: false,
			tool: { messageID: "msg-1", callID: "call-1" },
		});
	});

	it("rejects payloads without actions or text", () => {
		expect(
			parseSuggestionRequest({ id: "sug-1", sessionID: "ses-1", text: "Hi", actions: [] }),
		).toBe(undefined);
		expect(
			parseSuggestionRequest({
				id: "sug-1",
				sessionID: "ses-1",
				text: "",
				actions: [{ label: "Go", prompt: "go" }],
			}),
		).toBeUndefined();
	});
});

describe("applySuggestionEvent", () => {
	it("adds a shown suggestion and ignores duplicates", () => {
		const first = applySuggestionEvent([], shown(request()));
		expect(first).toEqual([request()]);
		expect(applySuggestionEvent(first ?? [], shown(request()))).toBeNull();
	});

	it("removes accepted and dismissed suggestions by request id", () => {
		const pending = [request(), request({ id: "sug-2", text: "Commit?" })];
		expect(
			applySuggestionEvent(pending, {
				type: "suggestion.accepted",
				properties: { sessionID: "ses-1", requestID: "sug-1", index: 0 },
			}),
		).toEqual([request({ id: "sug-2", text: "Commit?" })]);
		expect(
			applySuggestionEvent(pending, {
				type: "suggestion.dismissed",
				properties: { sessionID: "ses-1", requestID: "sug-2" },
			}),
		).toEqual([request()]);
	});

	it("returns null for unrelated events and unknown ids", () => {
		expect(
			applySuggestionEvent([request()], {
				type: "question.asked",
				properties: { id: "q-1", sessionID: "ses-1" },
			}),
		).toBeNull();
		expect(
			applySuggestionEvent([request()], {
				type: "suggestion.dismissed",
				properties: { sessionID: "ses-1", requestID: "sug-missing" },
			}),
		).toBeNull();
	});
});

describe("pickPendingSuggestion", () => {
	it("returns the first suggestion for the open session", () => {
		expect(
			pickPendingSuggestion([request({ id: "sug-other", sessionID: "ses-2" }), request()], "ses-1"),
		).toEqual(request());
	});

	it("returns null without a session id", () => {
		expect(pickPendingSuggestion([request()], undefined)).toBeNull();
	});
});

describe("isComposerPromptBusy", () => {
	it("is busy while the thread is running and no suggestion is pending", () => {
		expect(isComposerPromptBusy(true, null)).toBe(true);
	});

	it("is idle while the thread is not running", () => {
		expect(isComposerPromptBusy(false, null)).toBe(false);
		expect(isComposerPromptBusy(false, request({ blocking: false }))).toBe(false);
	});

	it("is idle while a suggestion is pending, even if the thread is still running", () => {
		expect(isComposerPromptBusy(true, request({ blocking: false }))).toBe(false);
		expect(isComposerPromptBusy(true, request())).toBe(false);
	});
});

describe("assistantWorkingIndicatorMode", () => {
	it("hides considering-next-steps while a suggestion is pending", () => {
		expect(assistantWorkingIndicatorMode(request())).toBe("never");
	});

	it("keeps the default indicator while the assistant is generating", () => {
		expect(assistantWorkingIndicatorMode(null)).toBe("no-text");
	});
});
