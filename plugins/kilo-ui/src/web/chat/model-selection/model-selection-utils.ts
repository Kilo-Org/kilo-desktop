import type { ModelSelectorEffortOption } from "../components/assistant-ui/model-selector.js";
import { modelRefToId, type KiloModelCatalog, type KiloModelRef } from "./model-catalog.js";

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

/** Normalize catalog `efforts` (including `true`) into selector options. */
export function normalizeEfforts(
	efforts: boolean | readonly ModelSelectorEffortOption[] | undefined,
): ModelSelectorEffortOption[] | undefined {
	if (!efforts) return undefined;
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

export function effortsForOptimisticTrigger(
	effort: string | undefined,
	efforts: readonly ModelSelectorEffortOption[] | undefined,
): ModelSelectorEffortOption[] | undefined {
	if (efforts && efforts.length > 0) return [...efforts];
	if (!effort) return undefined;
	return [{ id: effort, name: formatEffortLabel(effort) }];
}

/** Return a model only after the catalog confirms it is still available. */
export function resolveCatalogModel(
	catalog: KiloModelCatalog | undefined,
	model: KiloModelRef | undefined,
): KiloModelRef | undefined {
	if (!catalog || !model) return undefined;
	const id = modelRefToId(model);
	return catalog.models.some((entry) => entry.id === id) ? model : undefined;
}
