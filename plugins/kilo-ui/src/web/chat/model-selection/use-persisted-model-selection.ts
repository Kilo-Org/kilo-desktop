import { useCallback, useMemo, useState } from "react";

import type { ModelSelectorEffortOption } from "../components/assistant-ui/model-selector.js";
import {
	modelRefToId,
	pickDefaultModel,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog.js";
import { normalizeEfforts, resolveCatalogModel } from "./model-selection-utils.js";

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

function catalogEntry(catalog: KiloModelCatalog | undefined, ref: KiloModelRef | undefined) {
	if (!catalog || !ref) {
		return undefined;
	}
	return catalog.models.find((model) => model.id === modelRefToId(ref));
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
) {
	const agent = agentDefault?.agent ?? "";
	const scope = `${threadId ?? "draft"}:${agent}`;
	const [selections, setSelections] = useState<Record<string, SelectionState>>({});
	const configuredModel = resolveCatalogModel(catalog, agentDefault?.model);
	const defaultSelection = useMemo<SelectionState>(
		() =>
			configuredModel
				? {
						...DEFAULT_SELECTION,
						modelOverride: configuredModel,
						effort: agentDefault?.effort,
					}
				: DEFAULT_SELECTION,
		[agentDefault?.effort, configuredModel],
	);
	const selection = selections[scope] ?? defaultSelection;

	// Before the catalog loads, surface the session selection so the trigger can
	// paint immediately. Once the catalog arrives, validate / fall back as usual.
	const validatedModel = catalog
		? (resolveCatalogModel(catalog, selection.modelOverride) ?? pickDefaultModel(catalog))
		: undefined;
	const model = validatedModel ?? (catalog ? undefined : selection.modelOverride);

	const resolvedEntry = catalogEntry(catalog, model);
	const name = resolvedEntry?.name ?? selection.name;
	// Only fall back to sticky efforts while the catalog entry is unresolved;
	// a resolved model with no efforts must clear the previous model's list.
	const efforts = resolvedEntry ? normalizeEfforts(resolvedEntry.efforts) : selection.efforts;

	const setModel = useCallback(
		(next: KiloModelRef) => {
			setSelections((current) => {
				const active = current[scope] ?? defaultSelection;
				const entry = catalogEntry(catalog, next);
				const nextName = entry?.name ?? active.name;
				const nextEfforts = entry ? normalizeEfforts(entry.efforts) : active.efforts;
				return {
					...current,
					[scope]: {
						...active,
						modelOverride: next,
						name: nextName,
						efforts: nextEfforts,
						dirty: true,
					},
				};
			});
		},
		[catalog, defaultSelection, scope],
	);

	const setEffort = useCallback(
		(next: string) => {
			setSelections((current) => {
				const active = current[scope] ?? defaultSelection;
				const activeModel =
					resolveCatalogModel(catalog, active.modelOverride) ?? pickDefaultModel(catalog);
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
		},
		[catalog, defaultSelection, scope],
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
