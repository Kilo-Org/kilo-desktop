import type { ModelSelectorEffortOption } from "../components/assistant-ui/model-selector.js";
import {
	isKiloModelRef,
	modelRefToId,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog.js";

/** Versioned key — bump the suffix if the stored shape changes. */
export const MODEL_SELECTION_STORAGE_KEY = "kilo-ui.model-selection:v1";

export type StoredModelSelection = {
	model: KiloModelRef;
	/** Last known catalog display name for optimistic first paint. */
	name?: string;
	effort?: string;
	/** Last known effort options so the trigger can show the sticky effort label. */
	efforts?: readonly ModelSelectorEffortOption[];
};

const EFFORT_LABELS: Record<string, string> = {
	none: "None",
	low: "Low",
	medium: "Med",
	high: "High",
	xhigh: "xHigh",
	max: "Max",
	minimal: "Minimal",
};

export function formatEffortLabel(id: string): string {
	return EFFORT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function readEffortOptions(value: unknown): ModelSelectorEffortOption[] | undefined {
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}
	const efforts: ModelSelectorEffortOption[] = [];
	for (const entry of value) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof (entry as ModelSelectorEffortOption).id !== "string" ||
			typeof (entry as ModelSelectorEffortOption).name !== "string" ||
			(entry as ModelSelectorEffortOption).id.length === 0 ||
			(entry as ModelSelectorEffortOption).name.length === 0
		) {
			continue;
		}
		efforts.push({
			id: (entry as ModelSelectorEffortOption).id,
			name: (entry as ModelSelectorEffortOption).name,
		});
	}
	return efforts.length > 0 ? efforts : undefined;
}

/** Normalize catalog `efforts` (including `true`) into a storable option list. */
export function normalizeStoredEfforts(
	efforts: boolean | readonly ModelSelectorEffortOption[] | undefined,
): ModelSelectorEffortOption[] | undefined {
	if (!efforts) {
		return undefined;
	}
	if (efforts === true) {
		return [
			{ id: "low", name: formatEffortLabel("low") },
			{ id: "medium", name: formatEffortLabel("medium") },
			{ id: "high", name: formatEffortLabel("high") },
		];
	}
	const next = efforts
		.filter((entry) => entry.id.length > 0 && entry.name.length > 0)
		.map((entry) => ({ id: entry.id, name: entry.name }));
	return next.length > 0 ? next : undefined;
}

/**
 * Effort options for the optimistic trigger: prefer the last persisted list,
 * otherwise synthesize a single option from the sticky effort id.
 */
export function effortsForOptimisticTrigger(
	effort: string | undefined,
	efforts: readonly ModelSelectorEffortOption[] | undefined,
): ModelSelectorEffortOption[] | undefined {
	if (efforts && efforts.length > 0) {
		return [...efforts];
	}
	if (!effort) {
		return undefined;
	}
	return [{ id: effort, name: formatEffortLabel(effort) }];
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
			!isKiloModelRef((parsed as StoredModelSelection).model)
		) {
			return undefined;
		}
		const stored = parsed as StoredModelSelection;
		const effort = stored.effort;
		const name = stored.name;
		const efforts = readEffortOptions(stored.efforts);
		return {
			model: {
				providerID: stored.model.providerID,
				modelID: stored.model.modelID,
			},
			...(typeof name === "string" && name.length > 0 ? { name } : {}),
			...(typeof effort === "string" && effort.length > 0 ? { effort } : {}),
			...(efforts ? { efforts } : {}),
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
		const payload: StoredModelSelection = {
			model: {
				providerID: selection.model.providerID,
				modelID: selection.model.modelID,
			},
			...(selection.name !== undefined && selection.name.length > 0
				? { name: selection.name }
				: {}),
			...(selection.effort !== undefined && selection.effort.length > 0
				? { effort: selection.effort }
				: {}),
			...(selection.efforts && selection.efforts.length > 0
				? { efforts: selection.efforts.map((entry) => ({ id: entry.id, name: entry.name })) }
				: {}),
		};
		storage.setItem(MODEL_SELECTION_STORAGE_KEY, JSON.stringify(payload));
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
