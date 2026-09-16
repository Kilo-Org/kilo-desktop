import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { KiloModelCatalog, KiloModelRef } from "./model-catalog.js";
import { usePersistedModelSelection } from "./use-persisted-model-selection.js";

const defaultModel: KiloModelRef = {
	providerID: "anthropic",
	modelID: "claude-sonnet",
};
const alternateModel: KiloModelRef = {
	providerID: "anthropic",
	modelID: "claude-opus",
};
const catalog: KiloModelCatalog = {
	providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
	models: [
		{
			id: "anthropic/claude-sonnet",
			name: "Claude Sonnet",
			...defaultModel,
			efforts: [
				{ id: "low", name: "Low" },
				{ id: "medium", name: "Med" },
				{ id: "high", name: "High" },
			],
		},
		{
			id: "anthropic/claude-opus",
			name: "Claude Opus",
			...alternateModel,
			efforts: [
				{ id: "low", name: "Low" },
				{ id: "medium", name: "Med" },
				{ id: "high", name: "High" },
				{ id: "max", name: "Max" },
			],
		},
	],
	defaults: { anthropic: "claude-sonnet" },
};

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	cleanup();
});

describe("usePersistedModelSelection", () => {
	it("preserves effort when the model changes", () => {
		const { result } = renderHook(() => usePersistedModelSelection(catalog));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.validatedModel).toEqual(defaultModel);
		expect(result.current.name).toBe("Claude Sonnet");

		act(() => result.current.setEffort("high"));
		act(() => result.current.setModel(alternateModel));

		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.name).toBe("Claude Opus");
		expect(result.current.effort).toBe("high");
		expect(localStorage.length).toBe(0);

		act(() => result.current.setEffort("max"));

		expect(result.current.effort).toBe("max");
	});

	it("falls back to the catalog default and applies effort to that model", () => {
		const { result } = renderHook(() => usePersistedModelSelection(catalog));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.validatedModel).toEqual(defaultModel);
		expect(result.current.effort).toBeUndefined();

		act(() => result.current.setEffort("medium"));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.name).toBe("Claude Sonnet");
		expect(result.current.effort).toBe("medium");
	});

	it("uses configured defaults independently for each draft agent", () => {
		const { result, rerender } = renderHook(
			({ agent, configuredDefault }: { agent: string; configuredDefault: KiloModelRef }) =>
				usePersistedModelSelection(catalog, undefined, {
					agent,
					model: configuredDefault,
					effort: agent === "code" ? "high" : "max",
				}),
			{
				initialProps: { agent: "code", configuredDefault: defaultModel },
			},
		);

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.effort).toBe("high");

		act(() => result.current.setModel(alternateModel));
		rerender({ agent: "plan", configuredDefault: alternateModel });
		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.effort).toBe("max");

		rerender({ agent: "code", configuredDefault: defaultModel });
		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.effort).toBe("high");
	});

	it("keeps selection callbacks stable when configured defaults are unchanged", () => {
		const { result, rerender } = renderHook(() =>
			usePersistedModelSelection(catalog, undefined, {
				agent: "code",
				model: defaultModel,
				effort: "high",
			}),
		);
		const initialSetModel = result.current.setModel;
		const initialSetEffort = result.current.setEffort;
		const initialPromoteDraftModel = result.current.promoteDraftModel;

		rerender();

		expect(result.current.setModel).toBe(initialSetModel);
		expect(result.current.setEffort).toBe(initialSetEffort);
		expect(result.current.promoteDraftModel).toBe(initialPromoteDraftModel);
	});

	it("falls back when an agent's configured model is unavailable", () => {
		const { result } = renderHook(() =>
			usePersistedModelSelection(catalog, undefined, {
				agent: "code",
				model: { providerID: "missing", modelID: "removed" },
				effort: "high",
			}),
		);

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.effort).toBeUndefined();
	});

	it("surfaces the Kilo session model and effort before the catalog loads", () => {
		const { result } = renderHook(() =>
			usePersistedModelSelection(undefined, "thread-a", { agent: "code" }),
		);
		act(() =>
			result.current.hydrateThreadModel("thread-a", {
				agent: "code",
				model: defaultModel,
				effort: "high",
			}),
		);

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.validatedModel).toBeUndefined();
		expect(result.current.name).toBeUndefined();
		expect(result.current.effort).toBe("high");
		expect(result.current.efforts).toBeUndefined();
	});

	it("clears sticky efforts when switching to a model that has none", () => {
		const noEffortModel: KiloModelRef = {
			providerID: "anthropic",
			modelID: "claude-haiku",
		};
		const catalogWithNoEffortModel: KiloModelCatalog = {
			...catalog,
			models: [
				...catalog.models,
				{
					id: "anthropic/claude-haiku",
					name: "Claude Haiku",
					...noEffortModel,
				},
			],
		};

		const { result } = renderHook(() => usePersistedModelSelection(catalogWithNoEffortModel));

		act(() => result.current.setEffort("high"));
		expect(result.current.efforts).toEqual([
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Med" },
			{ id: "high", name: "High" },
		]);

		act(() => result.current.setModel(noEffortModel));

		expect(result.current.model).toEqual(noEffortModel);
		expect(result.current.name).toBe("Claude Haiku");
		expect(result.current.efforts).toBeUndefined();
		expect(result.current.effort).toBe("high");
	});

	it("keeps effort in memory when the catalog is missing", () => {
		const { result } = renderHook(() => usePersistedModelSelection(undefined));

		expect(result.current.model).toBeUndefined();

		act(() => result.current.setEffort("low"));

		expect(result.current.effort).toBe("low");

		act(() => result.current.setModel(defaultModel));

		expect(result.current.model).toEqual(defaultModel);
		expect(result.current.effort).toBe("low");
	});

	it("hydrates from Kilo while preserving an unsent local override", () => {
		const { result } = renderHook(() =>
			usePersistedModelSelection(catalog, "thread-a", { agent: "code" }),
		);

		act(() =>
			result.current.hydrateThreadModel("thread-a", {
				agent: "code",
				model: alternateModel,
				effort: "max",
			}),
		);
		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.effort).toBe("max");

		act(() => result.current.setModel(defaultModel));
		act(() =>
			result.current.hydrateThreadModel("thread-a", {
				agent: "code",
				model: alternateModel,
				effort: "max",
			}),
		);
		expect(result.current.model).toEqual(defaultModel);
	});

	it("promotes a draft selection when Kilo creates its session", () => {
		const { result, rerender } = renderHook(
			({ threadId }: { threadId: string | undefined }) =>
				usePersistedModelSelection(catalog, threadId),
			{ initialProps: { threadId: undefined as string | undefined } },
		);

		act(() => result.current.setModel(alternateModel));
		act(() => result.current.promoteDraftModel("thread-new"));
		rerender({ threadId: "thread-new" });

		expect(result.current.model).toEqual(alternateModel);

		rerender({ threadId: undefined });
		act(() => result.current.resetDraftModel());
		expect(result.current.model).toEqual(defaultModel);
	});
});
