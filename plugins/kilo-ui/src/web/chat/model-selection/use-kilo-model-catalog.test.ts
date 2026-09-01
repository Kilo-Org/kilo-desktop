import { describe, expect, it } from "vitest";

import { isModelCatalogPending } from "./use-kilo-model-catalog.js";

describe("isModelCatalogPending", () => {
	it("is pending on the initial catalog fetch", () => {
		expect(isModelCatalogPending({ isPending: true, isFetching: true })).toBe(true);
	});

	it("is pending while an empty catalog is refetching", () => {
		expect(
			isModelCatalogPending({
				isPending: false,
				isFetching: true,
				data: { models: [] },
			}),
		).toBe(true);
	});

	it("is not pending when an empty catalog has finished loading", () => {
		expect(
			isModelCatalogPending({
				isPending: false,
				isFetching: false,
				data: { models: [] },
			}),
		).toBe(false);
	});

	it("keeps a populated catalog usable while it refetches", () => {
		expect(
			isModelCatalogPending({
				isPending: false,
				isFetching: true,
				data: { models: [{ id: "anthropic/claude-sonnet" }] },
			}),
		).toBe(false);
	});
});
