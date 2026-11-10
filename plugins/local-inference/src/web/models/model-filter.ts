import type { LocalModel } from "../../contracts/index";

export const modelSourceFilters = [
	{ value: "all", label: "All models" },
	{ value: "catalog", label: "Catalog models" },
	{ value: "imported", label: "Imported models" },
] as const;

export type ModelSourceFilter = (typeof modelSourceFilters)[number]["value"];

export function filterLocalModels(
	models: readonly LocalModel[],
	search: string,
	source: ModelSourceFilter,
): LocalModel[] {
	const normalizedSearch = search.trim().toLocaleLowerCase();
	return models.filter((model) => {
		if (source === "catalog" && !model.catalog) return false;
		if (source === "imported" && model.catalog) return false;
		if (!normalizedSearch) return true;

		return [model.name, model.path, model.catalog?.publisher]
			.filter((value): value is string => Boolean(value))
			.some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
	});
}
