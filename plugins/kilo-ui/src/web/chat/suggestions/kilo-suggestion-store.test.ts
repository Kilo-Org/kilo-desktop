import { describe, expect, it } from "vitest";

import type { KiloSuggestionRequest } from "./kilo-suggestion-logic.js";
import { createKiloSuggestionStore } from "./kilo-suggestion-store.js";

const request = (overrides?: Partial<KiloSuggestionRequest>): KiloSuggestionRequest => ({
	id: "sug-1",
	sessionID: "ses-1",
	text: "Run a local review?",
	actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
	...overrides,
});

describe("createKiloSuggestionStore", () => {
	it("tracks shown and dismissed suggestions", () => {
		const store = createKiloSuggestionStore();
		store.getState().applyEvent({
			type: "suggestion.shown",
			properties: request(),
		});
		expect(store.getState().pending).toEqual([request()]);

		store.getState().applyEvent({
			type: "suggestion.dismissed",
			properties: { sessionID: "ses-1", requestID: "sug-1" },
		});
		expect(store.getState().pending).toEqual([]);
	});

	it("hydrates the pending list from the server snapshot", () => {
		const store = createKiloSuggestionStore();
		store.getState().applyEvent({
			type: "suggestion.shown",
			properties: request({ id: "sug-stale" }),
		});
		store.getState().hydrate([request()], store.getState().activityEpoch);
		expect(store.getState().pending).toEqual([request()]);
	});

	it("keeps a live shown that races an empty hydration snapshot", () => {
		const store = createKiloSuggestionStore();
		const sinceEpoch = store.getState().activityEpoch;
		store.getState().applyEvent({
			type: "suggestion.shown",
			properties: request(),
		});
		store.getState().hydrate([], sinceEpoch);
		expect(store.getState().pending).toEqual([request()]);
	});

	it("keeps a live dismiss that races a snapshot still listing the request", () => {
		const store = createKiloSuggestionStore();
		store.getState().applyEvent({
			type: "suggestion.shown",
			properties: request(),
		});
		const sinceEpoch = store.getState().activityEpoch;
		store.getState().applyEvent({
			type: "suggestion.dismissed",
			properties: { sessionID: "ses-1", requestID: "sug-1" },
		});
		store.getState().hydrate([request()], sinceEpoch);
		expect(store.getState().pending).toEqual([]);
	});
});
