import type { ModelSelectorEffortOption } from "./model-selector";
import { isSelectableModel, type KiloModelCatalog, type KiloModelRef } from "./model-catalog";

const EFFORT_LABELS: Record<string, string> = {
	none: "None",
	low: "Low",
	medium: "Med",
	high: "High",
	xhigh: "xHigh",
	max: "Max",
	minimal: "Minimal",
};

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

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

/** Keep the selected effort when possible, otherwise use the nearest known effort. */
export function preserveEffort(
	effort: string | undefined,
	efforts: readonly ModelSelectorEffortOption[] | undefined,
): string | undefined {
	if (!effort || !efforts?.length) return undefined;
	if (efforts.some((option) => option.id === effort)) return effort;

	const rank = EFFORT_ORDER.indexOf(effort);
	if (rank === -1) return undefined;

	return efforts
		.map((option, index) => ({
			id: option.id,
			index,
			rank: EFFORT_ORDER.indexOf(option.id),
			distance: Math.abs(EFFORT_ORDER.indexOf(option.id) - rank),
		}))
		.filter((option) => option.rank !== -1)
		.sort((a, b) => a.distance - b.distance || b.rank - a.rank || a.index - b.index)[0]?.id;
}

/** Return a model only after the catalog confirms it is still available. */
export function resolveCatalogModel(
	catalog: KiloModelCatalog | undefined,
	model: KiloModelRef | undefined,
): KiloModelRef | undefined {
	if (!catalog || !model) return undefined;
	return isSelectableModel(catalog, model) ? model : undefined;
}
