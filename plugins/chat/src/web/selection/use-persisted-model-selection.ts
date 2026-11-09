import { useCallback, useMemo, useState } from "react";

import type { ModelSelectorEffortOption } from "./model-selector";
import type { ModelPreferencesState as PersistedModelPreferences } from "../../contracts";
import {
	modelRefToId,
	pickDefaultModel,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog";
import { normalizeEfforts, preserveEffort, resolveCatalogModel } from "./model-selection-utils";

type SelectionState = {
	modelOverride: KiloModelRef | undefined;
	/** Last known display name for optimistic first paint. */
	name: string | undefined;
	effort: string | undefined;
	efforts: readonly ModelSelectorEffortOption[] | undefined;
	dirty: boolean;
};

const DEFAULT_SELECTION: SelectionState = {
	modelOverride: undefined,
	name: undefined,
	effort: undefined,
	efforts: undefined,
	dirty: false,
};

type AgentModelDefault = {
	agent: string;
	model?: KiloModelRef;
	effort?: string;
};

type RememberModelPreference = (
	agent: string,
	model: KiloModelRef,
	effort: string | undefined,
) => void;

function sameModel(left: KiloModelRef | undefined, right: KiloModelRef | undefined): boolean {
	return left?.providerID === right?.providerID && left?.modelID === right?.modelID;
}

function modelRef(model: KiloModelRef): KiloModelRef {
	return { providerID: model.providerID, modelID: model.modelID };
}

function variantKey(agent: string, model: KiloModelRef): string {
	return `${agent}/${model.providerID}/${model.modelID}`;
}

function normalizeEffort(effort: string | undefined): string | undefined {
	return effort || undefined;
}

function rememberedEffort(
	preferences: PersistedModelPreferences | undefined,
	agent: string,
	model: KiloModelRef,
): string | undefined {
	if (sameModel(model, preferences?.preferred)) {
		return preferences?.preferred?.variant || undefined;
	}
	return normalizeEffort(preferences?.variantSelections[variantKey(agent, model)]);
}

function catalogEntry(catalog: KiloModelCatalog | undefined, ref: KiloModelRef | undefined) {
	if (!catalog || !ref) {
		return undefined;
	}
	return catalog.models.find((model) => model.id === modelRefToId(ref));
}

function resolvePreference(
	catalog: KiloModelCatalog | undefined,
	model: KiloModelRef | undefined,
): KiloModelRef | undefined {
	if (catalog?.providerReady === false && model?.providerID === "kilo") return undefined;
	return resolveCatalogModel(catalog, model);
}

function automaticDefault(
	catalog: KiloModelCatalog | undefined,
	recentModels: readonly KiloModelRef[],
): KiloModelRef | undefined {
	if (!catalog) return undefined;
	if (catalog.providerReady === undefined) return pickDefaultModel(catalog);
	if (catalog.providerReady === false) {
		for (const recent of recentModels) {
			const resolved = resolveCatalogModel(catalog, recent);
			if (resolved && resolved.providerID !== "kilo") return resolved;
		}
		for (const provider of catalog.providers) {
			if (!provider.connected || provider.id === "kilo") continue;
			const defaultModelID = catalog.defaults[provider.id];
			const model = catalog.models.find(
				(candidate) =>
					candidate.providerID === provider.id &&
					!candidate.disabled &&
					(defaultModelID ? candidate.modelID === defaultModelID : true),
			);
			if (model) return { providerID: model.providerID, modelID: model.modelID };
		}
		return undefined;
	}
	if (catalog.organizationId) {
		const recommended = resolveCatalogModel(
			catalog,
			catalog.defaults.kilo ? { providerID: "kilo", modelID: catalog.defaults.kilo } : undefined,
		);
		if (recommended) return recommended;
		const firstKilo = catalog.models.find((model) => model.providerID === "kilo");
		return firstKilo ? { providerID: firstKilo.providerID, modelID: firstKilo.modelID } : undefined;
	}
	for (const recent of recentModels) {
		const resolved = resolveCatalogModel(catalog, recent);
		if (resolved) return resolved;
	}
	return resolveCatalogModel(catalog, { providerID: "kilo", modelID: "kilo-auto/free" });
}

/**
 * Thread-scoped model + sticky effort, hydrated from Kilo session state.
 * Unsent overrides stay in memory until Kilo persists them with the next prompt.
 * Falls back to Auto Free (then another Kilo Auto model, then the catalog
 * default for non-Kilo providers) when the session has no model or its model
 * is no longer in the catalog.
 */
export function usePersistedModelSelection(
	catalog: KiloModelCatalog | undefined,
	threadId?: string,
	agentDefault?: AgentModelDefault,
	preferences?: PersistedModelPreferences,
	onRemember?: RememberModelPreference,
	onRecent?: (model: KiloModelRef) => void,
) {
	const agent = agentDefault?.agent ?? "";
	const scope = `${threadId ?? "draft"}:${agent}`;
	const [selections, setSelections] = useState<Record<string, SelectionState>>({});
	const preferredModel = resolvePreference(
		catalog,
		preferences?.preferred ? modelRef(preferences.preferred) : undefined,
	);
	const rememberedAgentModel = resolvePreference(catalog, preferences?.modelSelections[agent]);
	const configuredModel = resolvePreference(catalog, agentDefault?.model);
	const globalConfiguredModel = resolvePreference(catalog, catalog?.configuredModel);
	const defaultModel =
		preferredModel ??
		rememberedAgentModel ??
		configuredModel ??
		globalConfiguredModel ??
		automaticDefault(catalog, preferences?.recentModels ?? []);
	const defaultEffort = defaultModel
		? sameModel(defaultModel, preferences?.preferred)
			? normalizeEffort(preferences?.preferred?.variant)
			: (rememberedEffort(preferences, agent, defaultModel) ??
				(sameModel(defaultModel, configuredModel) ? agentDefault?.effort : undefined))
		: undefined;
	const defaultSelection = useMemo<SelectionState>(
		() =>
			defaultModel
				? {
						...DEFAULT_SELECTION,
						modelOverride: defaultModel,
						effort: defaultEffort,
					}
				: DEFAULT_SELECTION,
		[defaultEffort, defaultModel],
	);
	const selection = selections[scope] ?? defaultSelection;

	// Before the catalog loads, surface the session selection so the trigger can
	// paint immediately. Once the catalog arrives, validate / fall back as usual.
	const validatedModel = catalog
		? (resolvePreference(catalog, selection.modelOverride) ??
			automaticDefault(catalog, preferences?.recentModels ?? []))
		: undefined;
	const model = validatedModel ?? (catalog ? undefined : selection.modelOverride);

	const resolvedEntry = catalogEntry(catalog, model);
	const name = resolvedEntry?.name ?? selection.name;
	// Only fall back to sticky efforts while the catalog entry is unresolved;
	// a resolved model with no efforts must clear the previous model's list.
	const efforts = resolvedEntry ? normalizeEfforts(resolvedEntry.efforts) : selection.efforts;

	const setModel = useCallback(
		(next: KiloModelRef) => {
			const entry = catalogEntry(catalog, next);
			const nextEffort = entry
				? (preserveEffort(selection.effort, normalizeEfforts(entry.efforts)) ??
					rememberedEffort(preferences, agent, next))
				: selection.effort;
			setSelections((current) => {
				const active = current[scope] ?? defaultSelection;
				const nextName = entry?.name ?? active.name;
				const nextEfforts = entry ? normalizeEfforts(entry.efforts) : active.efforts;
				return {
					...current,
					[scope]: {
						...active,
						modelOverride: next,
						name: nextName,
						effort: nextEffort,
						efforts: nextEfforts,
						dirty: true,
					},
				};
			});
			if (threadId === undefined && agent) onRemember?.(agent, next, nextEffort);
			if (threadId !== undefined) onRecent?.(next);
		},
		[
			agent,
			catalog,
			defaultSelection,
			onRecent,
			onRemember,
			preferences,
			scope,
			selection.effort,
			threadId,
		],
	);

	const setEffort = useCallback(
		(next: string) => {
			const activeModel =
				resolveCatalogModel(catalog, selection.modelOverride) ?? pickDefaultModel(catalog);
			setSelections((current) => {
				const active = current[scope] ?? defaultSelection;
				if (activeModel) {
					const entry = catalogEntry(catalog, activeModel);
					const nextName = entry?.name ?? active.name;
					const nextEfforts = entry ? normalizeEfforts(entry.efforts) : active.efforts;
					return {
						...current,
						[scope]: {
							...active,
							effort: next,
							name: nextName,
							efforts: nextEfforts,
							dirty: true,
						},
					};
				}
				return { ...current, [scope]: { ...active, effort: next, dirty: true } };
			});
			if (threadId === undefined && agent && activeModel) onRemember?.(agent, activeModel, next);
		},
		[agent, catalog, defaultSelection, onRemember, scope, selection.modelOverride, threadId],
	);
	const hydrateThreadModel = useCallback(
		(id: string, next: { agent: string; model: KiloModelRef; effort?: string }) => {
			const hydratedScope = `${id}:${next.agent}`;
			setSelections((current) => {
				const existing = current[hydratedScope];
				const matches =
					existing?.modelOverride?.providerID === next.model.providerID &&
					existing.modelOverride.modelID === next.model.modelID &&
					existing.effort === next.effort;
				if (existing?.dirty && !matches) return current;
				if (matches && !existing.dirty) return current;
				return {
					...current,
					[hydratedScope]: {
						modelOverride: next.model,
						name: undefined,
						effort: next.effort,
						efforts: undefined,
						dirty: false,
					},
				};
			});
		},
		[],
	);
	const promoteDraftModel = useCallback(
		(id: string) => {
			setSelections((current) => ({
				...current,
				[`${id}:${agent}`]: current[scope] ?? { ...defaultSelection, dirty: true },
			}));
		},
		[agent, defaultSelection, scope],
	);
	const resetDraftModel = useCallback(() => {
		setSelections((current) =>
			Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith("draft:"))),
		);
	}, []);

	return {
		model,
		/** Catalog-validated model that is safe to send to Kilo. */
		validatedModel,
		setModel,
		/** Display name for the optimistic trigger before the catalog loads. */
		name,
		effort: selection.effort,
		/** Effort options for the optimistic trigger before the catalog loads. */
		efforts,
		setEffort,
		hydrateThreadModel,
		promoteDraftModel,
		resetDraftModel,
	};
}
