import { useCallback, useState } from "react";

import type { ModelSelectorEffortOption } from "../components/assistant-ui/model-selector.js";
import {
	modelRefToId,
	pickDefaultModel,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog.js";
import {
	normalizeStoredEfforts,
	readModelSelection,
	resolveStoredModel,
	writeModelSelection,
} from "./selection-storage.js";

type SelectionState = {
	modelOverride: KiloModelRef | undefined;
	/** Last known display name for optimistic first paint. */
	name: string | undefined;
	effort: string | undefined;
	efforts: readonly ModelSelectorEffortOption[] | undefined;
};

function selectionFromStorage(): SelectionState {
	const stored = readModelSelection();
	return {
		modelOverride: stored?.model,
		name: stored?.name,
		effort: stored?.effort,
		efforts: stored?.efforts,
	};
}

function catalogEntry(catalog: KiloModelCatalog | undefined, ref: KiloModelRef | undefined) {
	if (!catalog || !ref) {
		return undefined;
	}
	return catalog.models.find((model) => model.id === modelRefToId(ref));
}

/**
 * Selected model + sticky effort, restored from localStorage across refreshes.
 * Falls back to the catalog default when nothing is stored or the stored model
 * is no longer in the catalog.
 */
export function usePersistedModelSelection(catalog: KiloModelCatalog | undefined) {
	const [selection, setSelection] = useState<SelectionState>(selectionFromStorage);

	// Before the catalog loads, surface the stored selection so the trigger can
	// paint immediately. Once the catalog arrives, validate / fall back as usual.
	const validatedModel = catalog
		? (resolveStoredModel(catalog, selection.modelOverride) ?? pickDefaultModel(catalog))
		: undefined;
	const model = validatedModel ?? (catalog ? undefined : selection.modelOverride);

	const resolvedEntry = catalogEntry(catalog, model);
	const name = resolvedEntry?.name ?? selection.name;
	const efforts = normalizeStoredEfforts(resolvedEntry?.efforts) ?? selection.efforts;

	const setModel = useCallback(
		(next: KiloModelRef) => {
			setSelection((current) => {
				const entry = catalogEntry(catalog, next);
				const nextName = entry?.name ?? current.name;
				const nextEfforts = normalizeStoredEfforts(entry?.efforts) ?? current.efforts;
				writeModelSelection({
					model: next,
					...(nextName !== undefined ? { name: nextName } : {}),
					...(current.effort !== undefined ? { effort: current.effort } : {}),
					...(nextEfforts !== undefined ? { efforts: nextEfforts } : {}),
				});
				return {
					...current,
					modelOverride: next,
					name: nextName,
					efforts: nextEfforts,
				};
			});
		},
		[catalog],
	);

	const setEffort = useCallback(
		(next: string) => {
			setSelection((current) => {
				const modelToStore =
					resolveStoredModel(catalog, current.modelOverride) ?? pickDefaultModel(catalog);
				if (modelToStore) {
					const entry = catalogEntry(catalog, modelToStore);
					const nextName = entry?.name ?? current.name;
					const nextEfforts = normalizeStoredEfforts(entry?.efforts) ?? current.efforts;
					writeModelSelection({
						model: modelToStore,
						effort: next,
						...(nextName !== undefined ? { name: nextName } : {}),
						...(nextEfforts !== undefined ? { efforts: nextEfforts } : {}),
					});
					return {
						...current,
						effort: next,
						name: nextName,
						efforts: nextEfforts,
					};
				}
				return { ...current, effort: next };
			});
		},
		[catalog],
	);

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
	};
}
