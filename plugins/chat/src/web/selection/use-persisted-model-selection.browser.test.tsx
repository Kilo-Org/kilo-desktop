import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatSelections } from "./chat-selections";
import type { KiloModelCatalog, KiloModelRef } from "./model-catalog";
import {
	persistedPreferences,
	usePersistedModelSelection,
	type PersistedModelPreferences,
} from "./use-persisted-model-selection";

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
	it("restores the preferred model before per-agent and configured defaults", () => {
		const preferences: PersistedModelPreferences = {
			modelSelections: { code: defaultModel },
			preferred: { ...alternateModel, variant: "max" },
			variantSelections: {},
			recentModels: [],
			favorites: [],
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(
				catalog,
				undefined,
				{ agent: "code", model: defaultModel, effort: "high" },
				preferences,
			),
		);

		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.effort).toBe("max");
	});

	it("falls through an unavailable preferred model to the agent's remembered model", () => {
		const preferences: PersistedModelPreferences = {
			modelSelections: { code: alternateModel },
			preferred: { providerID: "missing", modelID: "removed", variant: "high" },
			variantSelections: { "code/anthropic/claude-opus": "max" },
			recentModels: [],
			favorites: [],
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(
				catalog,
				undefined,
				{ agent: "code", model: defaultModel, effort: "high" },
				preferences,
			),
		);

		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.effort).toBe("max");
	});

	it("starts a signed-in person without a remembered model on a connected provider's model", () => {
		const { result } = renderHook(() =>
			usePersistedModelSelection(
				{ ...catalog, defaults: {}, providerReady: true, organizationId: null },
				undefined,
				{ agent: "code" },
				{
					modelSelections: {},
					variantSelections: {},
					recentModels: [],
					favorites: [],
				},
			),
		);

		expect(result.current.validatedModel).toEqual(defaultModel);
	});

	it("starts on the provider's default when kilo.core names one", () => {
		const { result } = renderHook(() =>
			usePersistedModelSelection(
				{ ...catalog, defaults: { anthropic: "claude-opus" }, providerReady: true },
				undefined,
				{ agent: "code" },
			),
		);

		expect(result.current.validatedModel).toEqual(alternateModel);
	});

	it("uses the global Kilo configured model after the agent default", () => {
		const globallyConfiguredCatalog: KiloModelCatalog = {
			...catalog,
			configuredModel: alternateModel,
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(globallyConfiguredCatalog, undefined, { agent: "code" }),
		);

		expect(result.current.model).toEqual(alternateModel);
	});

	it("prefers an agent's configured model over the global Kilo configured model", () => {
		const globallyConfiguredCatalog: KiloModelCatalog = {
			...catalog,
			configuredModel: alternateModel,
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(globallyConfiguredCatalog, undefined, {
				agent: "code",
				model: defaultModel,
			}),
		);

		expect(result.current.model).toEqual(defaultModel);
	});

	it("uses the organization recommendation instead of personal recents", () => {
		const orgModel = { providerID: "kilo", modelID: "org-recommended" };
		const orgCatalog: KiloModelCatalog = {
			providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }, ...catalog.providers],
			models: [
				{ id: "kilo/org-recommended", name: "Org Recommended", ...orgModel },
				...catalog.models,
			],
			defaults: { kilo: "org-recommended", ...catalog.defaults },
			connected: ["kilo", "anthropic"],
			providerReady: true,
			organizationId: "org-1",
		};
		const preferences: PersistedModelPreferences = {
			modelSelections: {},
			variantSelections: {},
			recentModels: [alternateModel],
			favorites: [],
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(orgCatalog, undefined, { agent: "code" }, preferences),
		);

		expect(result.current.model).toEqual(orgModel);
	});

	it("uses recent models before the hardcoded fallback for Personal", () => {
		const personalCatalog: KiloModelCatalog = {
			...catalog,
			connected: ["anthropic"],
			providerReady: true,
			organizationId: null,
		};
		const preferences: PersistedModelPreferences = {
			modelSelections: {},
			variantSelections: {},
			recentModels: [alternateModel],
			favorites: [],
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(personalCatalog, undefined, { agent: "code" }, preferences),
		);

		expect(result.current.model).toEqual(alternateModel);
	});

	it("suppresses pending Kilo preferences while retaining connected external models", () => {
		const kiloModel = { providerID: "kilo", modelID: "kilo-auto/free" };
		const pendingCatalog: KiloModelCatalog = {
			providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }, ...catalog.providers],
			models: [{ id: "kilo/kilo-auto/free", name: "Auto Free", ...kiloModel }, ...catalog.models],
			defaults: { kilo: "kilo-auto/free", ...catalog.defaults },
			connected: ["kilo", "anthropic"],
			providerReady: false,
		};
		const kiloPreferences: PersistedModelPreferences = {
			modelSelections: {},
			preferred: { ...kiloModel, variant: "" },
			variantSelections: {},
			recentModels: [],
			favorites: [],
		};
		const externalPreferences: PersistedModelPreferences = {
			...kiloPreferences,
			preferred: { ...alternateModel, variant: "" },
		};

		const kilo = renderHook(() =>
			usePersistedModelSelection(pendingCatalog, undefined, { agent: "code" }, kiloPreferences),
		);
		const external = renderHook(() =>
			usePersistedModelSelection(pendingCatalog, undefined, { agent: "code" }, externalPreferences),
		);

		expect(kilo.result.current.model).toEqual(defaultModel);
		expect(external.result.current.model).toEqual(alternateModel);
	});

	it("falls back to a connected external model while Kilo provider status is unavailable", () => {
		const pendingCatalog: KiloModelCatalog = {
			...catalog,
			connected: ["anthropic"],
			providerReady: false,
		};

		const { result } = renderHook(() =>
			usePersistedModelSelection(pendingCatalog, undefined, { agent: "code" }),
		);

		expect(result.current.model).toEqual(defaultModel);
	});

	it("treats a preferred default variant as authoritative", () => {
		const preferences: PersistedModelPreferences = {
			modelSelections: { code: alternateModel },
			preferred: { ...alternateModel, variant: "" },
			variantSelections: { "code/anthropic/claude-opus": "max" },
			recentModels: [],
			favorites: [],
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(
				catalog,
				undefined,
				{ agent: "code", model: defaultModel, effort: "high" },
				preferences,
			),
		);

		expect(result.current.model).toEqual(alternateModel);
		expect(result.current.effort).toBeUndefined();
	});

	it("remembers draft changes but keeps existing-session changes local", () => {
		const remembered: Array<{ agent: string; model: KiloModelRef; effort?: string }> = [];
		const onRemember = (agent: string, model: KiloModelRef, effort: string | undefined) => {
			remembered.push({ agent, model, ...(effort === undefined ? {} : { effort }) });
		};
		const draft = renderHook(() =>
			usePersistedModelSelection(
				catalog,
				undefined,
				{ agent: "code", model: defaultModel },
				undefined,
				onRemember,
			),
		);
		act(() => draft.result.current.setEffort("high"));
		act(() => draft.result.current.setModel(alternateModel));

		expect(remembered).toEqual([
			{ agent: "code", model: defaultModel, effort: "high" },
			{ agent: "code", model: alternateModel, effort: "high" },
		]);

		const thread = renderHook(() =>
			usePersistedModelSelection(
				catalog,
				"thread-a",
				{ agent: "code", model: defaultModel },
				undefined,
				onRemember,
			),
		);
		act(() => thread.result.current.setModel(alternateModel));
		act(() => thread.result.current.setEffort("max"));

		expect(remembered).toHaveLength(2);
	});

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

	it("restores saved draft effort before carrying over the current model's effort", () => {
		const preferences: PersistedModelPreferences = {
			modelSelections: {},
			preferred: { ...alternateModel, variant: "low" },
			variantSelections: { "code/anthropic/claude-sonnet": "high" },
			recentModels: [],
			favorites: [],
		};
		const remembered: Array<string | undefined> = [];
		const { result } = renderHook(() =>
			usePersistedModelSelection(
				catalog,
				undefined,
				{ agent: "code" },
				preferences,
				(_agent, _model, effort) => remembered.push(effort),
			),
		);

		expect(result.current.effort).toBe("low");
		act(() => result.current.setModel(defaultModel));

		expect(result.current.effort).toBe("high");
		act(() => result.current.setModel(alternateModel));
		expect(result.current.effort).toBe("low");
		expect(remembered).toEqual(["high", "low"]);
	});

	it("falls back to carryover if the destination's saved effort is no longer supported", () => {
		const preferences: PersistedModelPreferences = {
			modelSelections: {},
			preferred: { ...alternateModel, variant: "low" },
			variantSelections: { "code/anthropic/claude-sonnet": "max" },
			recentModels: [],
			favorites: [],
		};
		const { result } = renderHook(() =>
			usePersistedModelSelection(catalog, undefined, { agent: "code" }, preferences),
		);

		act(() => result.current.setModel(defaultModel));

		expect(result.current.effort).toBe("low");
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

	it("clears effort when switching to a model that has none", () => {
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
		expect(result.current.effort).toBeUndefined();
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

	describe("chat isolation across panes", () => {
		const remembering = (model: KiloModelRef, variant: string): PersistedModelPreferences => ({
			modelSelections: { code: model },
			preferred: { ...model, variant },
			variantSelections: {},
			recentModels: [model],
			favorites: [],
		});

		it("keeps a chat's model when its pane remounts after another session's draft changed the remembered one", () => {
			const chats = new ChatSelections();
			const before = renderHook(() =>
				usePersistedModelSelection(
					catalog,
					"chat-a",
					{ agent: "code" },
					remembering(defaultModel, "low"),
					undefined,
					undefined,
					{ chats },
				),
			);
			act(() =>
				before.result.current.hydrateThreadModel("chat-a", {
					agent: "code",
					model: defaultModel,
					effort: "low",
				}),
			);
			before.unmount();

			const after = renderHook(() =>
				usePersistedModelSelection(
					catalog,
					"chat-a",
					{ agent: "code" },
					remembering(alternateModel, "max"),
					undefined,
					undefined,
					{ chats },
				),
			);

			expect(after.result.current.model).toEqual(defaultModel);
			expect(after.result.current.validatedModel).toEqual(defaultModel);
			expect(after.result.current.effort).toBe("low");
		});

		it("keeps an unsent chat change when its pane remounts", () => {
			const chats = new ChatSelections();
			const render = () =>
				renderHook(() =>
					usePersistedModelSelection(
						catalog,
						"chat-a",
						{ agent: "code" },
						undefined,
						undefined,
						undefined,
						{ chats },
					),
				);
			const before = render();
			act(() =>
				before.result.current.hydrateThreadModel("chat-a", { agent: "code", model: defaultModel }),
			);
			act(() => before.result.current.setModel(alternateModel));
			act(() => before.result.current.setEffort("max"));
			before.unmount();

			const after = render();

			expect(after.result.current.model).toEqual(alternateModel);
			expect(after.result.current.effort).toBe("max");
		});

		it("restores a chat's effort for a model after switching away and reopening its pane", () => {
			const chats = new ChatSelections();
			const render = () =>
				renderHook(() =>
					usePersistedModelSelection(
						catalog,
						"chat-a",
						{ agent: "code" },
						remembering(defaultModel, "medium"),
						undefined,
						undefined,
						{ chats },
					),
				);
			const before = render();
			act(() =>
				before.result.current.hydrateThreadModel("chat-a", {
					agent: "code",
					model: defaultModel,
					effort: "high",
				}),
			);
			act(() => before.result.current.setModel(alternateModel));
			act(() => before.result.current.setEffort("low"));
			act(() =>
				before.result.current.hydrateThreadModel("chat-a", {
					agent: "code",
					model: alternateModel,
					effort: "low",
				}),
			);
			before.unmount();

			const { result } = render();
			act(() => result.current.setModel(defaultModel));
			expect(result.current.effort).toBe("high");
			act(() => result.current.setModel(alternateModel));
			expect(result.current.effort).toBe("low");
		});

		it("shows no model for a chat until its Kilo session is read, rather than the remembered one", () => {
			const chats = new ChatSelections();
			const { result } = renderHook(() =>
				usePersistedModelSelection(
					catalog,
					"chat-a",
					{ agent: "code" },
					remembering(alternateModel, "max"),
					undefined,
					undefined,
					{ chats },
				),
			);

			expect(result.current.model).toBeUndefined();
			expect(result.current.validatedModel).toBeUndefined();
			expect(result.current.effort).toBeUndefined();

			act(() => result.current.markThreadLoaded("chat-a"));

			expect(result.current.model).toEqual(alternateModel);
			expect(result.current.effort).toBe("max");
		});

		it("keeps a chat loading after an agent switch, even with a pick under its previous agent", () => {
			const chats = new ChatSelections();
			const { result, rerender } = renderHook(
				({ agent }: { agent: string }) =>
					usePersistedModelSelection(
						catalog,
						"chat-a",
						{ agent },
						remembering(alternateModel, "max"),
						undefined,
						undefined,
						{ chats },
					),
				{ initialProps: { agent: "code" } },
			);
			act(() => result.current.setModel(defaultModel));

			rerender({ agent: "plan" });

			expect(result.current.awaitingKilo).toBe(true);
			expect(result.current.validatedModel).toBeUndefined();

			act(() => result.current.markThreadLoaded("chat-a"));

			expect(result.current.awaitingKilo).toBe(false);
			expect(result.current.validatedModel).toEqual(alternateModel);
		});

		it("shows no model for a pane opening a chat whose id isn't known yet, rather than the draft defaults", () => {
			const { result } = renderHook(() =>
				usePersistedModelSelection(
					catalog,
					undefined,
					{ agent: "code" },
					remembering(alternateModel, "max"),
					undefined,
					undefined,
					{ chats: new ChatSelections(), opensChat: true },
				),
			);

			expect(result.current.model).toBeUndefined();
			expect(result.current.validatedModel).toBeUndefined();
			expect(result.current.awaitingKilo).toBe(true);
		});

		it("ignores picks, and leaves the remembered default alone, while a pane opening a chat waits for its id", () => {
			const remembered: KiloModelRef[] = [];
			const { result } = renderHook(() =>
				usePersistedModelSelection(
					catalog,
					undefined,
					{ agent: "code" },
					undefined,
					(_agent, model) => remembered.push(model),
					undefined,
					{ chats: new ChatSelections(), opensChat: true },
				),
			);

			act(() => result.current.setModel(alternateModel));
			act(() => result.current.setEffort("max"));

			expect(remembered).toEqual([]);
			expect(result.current.model).toBeUndefined();
			expect(result.current.effort).toBeUndefined();
		});

		it("falls back to the automatic default, not another chat's recent pick, when a chat's model is gone", () => {
			const autoFree: KiloModelRef = { providerID: "kilo", modelID: "kilo-auto/free" };
			const kiloCatalog: KiloModelCatalog = {
				...catalog,
				providerReady: true,
				providers: [...catalog.providers, { id: "kilo", name: "Kilo", connected: true }],
				models: [...catalog.models, { id: "kilo/kilo-auto/free", name: "Auto Free", ...autoFree }],
			};
			const chats = new ChatSelections();
			const { result } = renderHook(() =>
				usePersistedModelSelection(
					kiloCatalog,
					"chat-a",
					{ agent: "code" },
					remembering(alternateModel, "max"),
					undefined,
					undefined,
					{ chats },
				),
			);
			act(() =>
				result.current.hydrateThreadModel("chat-a", {
					agent: "code",
					model: { providerID: "missing", modelID: "removed" },
				}),
			);

			expect(result.current.validatedModel).toEqual(autoFree);
		});

		it("keeps a draft's selection for the chat its first send creates before it is promoted", () => {
			const chats = new ChatSelections();
			const { result, rerender } = renderHook(
				({ threadId }: { threadId: string | undefined }) =>
					usePersistedModelSelection(
						catalog,
						threadId,
						{ agent: "code" },
						undefined,
						undefined,
						undefined,
						{ chats, startedAsDraft: true },
					),
				{ initialProps: { threadId: undefined as string | undefined } },
			);
			act(() => result.current.setModel(alternateModel));

			rerender({ threadId: "chat-new" });

			expect(result.current.validatedModel).toEqual(alternateModel);
		});

		it("does not share a draft between panes of one window", () => {
			const chats = new ChatSelections();
			const draft = () =>
				renderHook(() =>
					usePersistedModelSelection(
						catalog,
						undefined,
						{ agent: "code" },
						undefined,
						undefined,
						undefined,
						{ chats },
					),
				);
			const first = draft();
			const second = draft();

			act(() => first.result.current.setModel(alternateModel));

			expect(second.result.current.model).toEqual(defaultModel);
		});
	});
});

describe("persistedPreferences", () => {
	it("reads kilo.core's preferences with models as the picker names them", () => {
		expect(
			persistedPreferences({
				byAgent: { code: { aiProviderId: "anthropic", modelId: "claude-sonnet" } },
				preferred: { aiProviderId: "anthropic", modelId: "claude-opus", variant: "max" },
				variants: { "code/anthropic/claude-opus": "max" },
				recent: [{ aiProviderId: "anthropic", modelId: "claude-opus" }],
				favorites: [{ aiProviderId: "anthropic", modelId: "claude-sonnet" }],
				autoFreeModels: true,
			}),
		).toEqual({
			modelSelections: { code: defaultModel },
			preferred: { ...alternateModel, variant: "max" },
			variantSelections: { "code/anthropic/claude-opus": "max" },
			recentModels: [alternateModel],
			favorites: [defaultModel],
		});
		expect(
			persistedPreferences({
				byAgent: {},
				variants: {},
				recent: [],
				favorites: [],
				autoFreeModels: false,
			}).preferred,
		).toBeUndefined();
	});
});
