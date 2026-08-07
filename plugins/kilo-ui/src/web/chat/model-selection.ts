import { modelRefToId, type KiloModelCatalog, type KiloModelRef } from "./model-catalog.js";

/** Versioned key — bump the suffix if the stored shape changes. */
export const MODEL_SELECTION_STORAGE_KEY = "kilo-ui.model-selection:v1";

export type StoredModelSelection = {
	model: KiloModelRef;
	effort?: string;
};

function isModelRef(value: unknown): value is KiloModelRef {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as KiloModelRef).providerID === "string" &&
		typeof (value as KiloModelRef).modelID === "string" &&
		(value as KiloModelRef).providerID.length > 0 &&
		(value as KiloModelRef).modelID.length > 0
	);
}

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
			!isModelRef((parsed as StoredModelSelection).model)
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

/** Prefer a stored model when it still exists in the catalog; otherwise undefined. */
export function resolveStoredModel(
	catalog: KiloModelCatalog | undefined,
	stored: KiloModelRef | undefined,
): KiloModelRef | undefined {
	if (!stored) {
		return undefined;
	}
	if (!catalog) {
		return stored;
	}
	const id = modelRefToId(stored);
	return catalog.models.some((model) => model.id === id) ? stored : undefined;
}
