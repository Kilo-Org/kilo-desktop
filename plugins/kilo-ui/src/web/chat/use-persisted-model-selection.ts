import { useCallback, useMemo, useState } from "react";

import { pickDefaultModel, type KiloModelCatalog, type KiloModelRef } from "./model-catalog.js";
import {
	readModelSelection,
	resolveStoredModel,
	writeModelSelection,
	type StoredModelSelection,
} from "./model-selection.js";

type SelectionState = {
	modelOverride: KiloModelRef | undefined;
	effort: string | undefined;
};

function selectionFromStorage(): SelectionState {
	const stored = readModelSelection();
	return {
		modelOverride: stored?.model,
		effort: stored?.effort,
	};
}

function persist(selection: StoredModelSelection): void {
	writeModelSelection(selection);
}

/**
 * Selected model + sticky effort, restored from localStorage across refreshes.
 * Falls back to the catalog default when nothing is stored or the stored model
 * is no longer in the catalog.
 */
export function usePersistedModelSelection(catalog: KiloModelCatalog | undefined) {
	const [selection, setSelection] = useState<SelectionState>(selectionFromStorage);

	const model = resolveStoredModel(catalog, selection.modelOverride) ?? pickDefaultModel(catalog);

	const setModel = useCallback((next: KiloModelRef) => {
		setSelection((current) => {
			const nextState: SelectionState = {
				modelOverride: next,
				effort: current.effort,
			};
			persist({
				model: next,
				...(nextState.effort !== undefined ? { effort: nextState.effort } : {}),
			});
			return nextState;
		});
	}, []);

	const setEffort = useCallback(
		(next: string) => {
			setSelection((current) => {
				const nextState: SelectionState = {
					modelOverride: current.modelOverride,
					effort: next,
				};
				const modelToStore =
					resolveStoredModel(catalog, current.modelOverride) ?? pickDefaultModel(catalog);
				if (modelToStore) {
					persist({ model: modelToStore, effort: next });
				}
				return nextState;
			});
		},
		[catalog],
	);

	return useMemo(
		() => ({
			model,
			setModel,
			effort: selection.effort,
			setEffort,
		}),
		[model, selection.effort, setEffort, setModel],
	);
}
