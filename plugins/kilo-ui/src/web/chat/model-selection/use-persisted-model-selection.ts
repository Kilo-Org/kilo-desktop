import { useCallback, useState } from "react";

import { pickDefaultModel, type KiloModelCatalog, type KiloModelRef } from "./model-catalog.js";
import {
	readModelSelection,
	resolveStoredModel,
	writeModelSelection,
} from "./selection-storage.js";

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
			writeModelSelection({
				model: next,
				...(current.effort !== undefined ? { effort: current.effort } : {}),
			});
			return { ...current, modelOverride: next };
		});
	}, []);

	const setEffort = useCallback(
		(next: string) => {
			setSelection((current) => {
				const modelToStore =
					resolveStoredModel(catalog, current.modelOverride) ?? pickDefaultModel(catalog);
				if (modelToStore) {
					writeModelSelection({ model: modelToStore, effort: next });
				}
				return { ...current, effort: next };
			});
		},
		[catalog],
	);

	return {
		model,
		setModel,
		effort: selection.effort,
		setEffort,
	};
}
