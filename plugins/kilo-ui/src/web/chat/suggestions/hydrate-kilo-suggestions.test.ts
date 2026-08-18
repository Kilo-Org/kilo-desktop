import { describe, expect, it, vi } from "vitest";

import { hydrateKiloSuggestions } from "./hydrate-kilo-suggestions.js";
import { createKiloSuggestionStore } from "./kilo-suggestion-store.js";

const pending = {
	id: "sug-1",
	sessionID: "ses-1",
	text: "Run a local review?",
	actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
};

describe("hydrateKiloSuggestions", () => {
	it("seeds pending suggestions from a successful list", async () => {
		const store = createKiloSuggestionStore();
		const client = {
			suggestion: {
				list: vi.fn(async () => ({ data: [pending] })),
			},
		};

		await hydrateKiloSuggestions(client, store);

		expect(store.getState().pending).toEqual([pending]);
	});

	it("tolerates list failures", async () => {
		const store = createKiloSuggestionStore();
		const client = {
			suggestion: {
				list: vi.fn(async () => {
					throw new Error("suggestion offline");
				}),
			},
		};

		await expect(hydrateKiloSuggestions(client, store)).resolves.toBeUndefined();
		expect(store.getState().pending).toEqual([]);
	});

	it("keeps a live shown that races an empty list snapshot", async () => {
		const store = createKiloSuggestionStore();
		let resolveList!: (value: { data: (typeof pending)[] }) => void;
		const client = {
			suggestion: {
				list: vi.fn(
					() =>
						new Promise<{ data: (typeof pending)[] }>((resolve) => {
							resolveList = resolve;
						}),
				),
			},
		};

		const hydration = hydrateKiloSuggestions(client, store);
		store.getState().applyEvent({
			type: "suggestion.shown",
			properties: pending,
		});
		resolveList({ data: [] });
		await hydration;

		expect(store.getState().pending).toEqual([pending]);
	});
});
