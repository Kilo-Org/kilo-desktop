import {
	isKiloModelRef,
	modelRefToId,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog.js";

/** Versioned key — bump the suffix if the stored shape changes. */
export const MODEL_SELECTION_STORAGE_KEY = "kilo-ui.model-selection:v1";

type StoredModelSelection = {
	model: KiloModelRef;
	effort?: string;
};

export function readModelSelection(
	storage: Storage | undefined = globalThis.localStorage,
): StoredModelSelection | undefined {
	if (!storage) {
		return undefined;
	}
	try {
		const raw = storage.getItem(MODEL_SELECTION_STORAGE_KEY);
		if (!raw) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(raw);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			!isKiloModelRef((parsed as StoredModelSelection).model)
		) {
			return undefined;
		}
		const effort = (parsed as StoredModelSelection).effort;
		return {
			model: {
				providerID: (parsed as StoredModelSelection).model.providerID,
				modelID: (parsed as StoredModelSelection).model.modelID,
			},
			...(typeof effort === "string" && effort.length > 0 ? { effort } : {}),
		};
	} catch {
		return undefined;
	}
}

export function writeModelSelection(
	selection: StoredModelSelection,
	storage: Storage | undefined = globalThis.localStorage,
): void {
	if (!storage) {
		return;
	}
	try {
		storage.setItem(MODEL_SELECTION_STORAGE_KEY, JSON.stringify(selection));
	} catch {
		// Quota / private mode — ignore; in-memory state still works for the session.
	}
}

/** Return a stored model only after the catalog confirms it is still available. */
export function resolveStoredModel(
	catalog: KiloModelCatalog | undefined,
	stored: KiloModelRef | undefined,
): KiloModelRef | undefined {
	if (!catalog || !stored) {
		return undefined;
	}
	const id = modelRefToId(stored);
	return catalog.models.some((model) => model.id === id) ? stored : undefined;
}
