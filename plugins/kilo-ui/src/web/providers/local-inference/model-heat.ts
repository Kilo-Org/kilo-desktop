import type { LocalInferenceStatus } from "./contract.js";

export type ModelHeat = "warm" | "cold" | "loading";

export function modelHeat(status: LocalInferenceStatus | undefined, modelId: string): ModelHeat {
	if (status?.status === "loading-model" && status.modelId === modelId) {
		return "loading";
	}
	const loaded =
		status?.status === "ready" || status?.status === "loading-model"
			? (status.loadedModelIds ?? [])
			: [];
	if (
		loaded.includes(modelId) ||
		(status?.status === "ready" && status.loadedModelId === modelId)
	) {
		return "warm";
	}
	return "cold";
}

export function modelHeatLabel(heat: ModelHeat): string {
	switch (heat) {
		case "warm":
			return "Loaded in memory";
		case "cold":
			return "Not loaded yet";
		case "loading":
			return "Loading into memory…";
		default: {
			const exhaustive: never = heat;
			return exhaustive;
		}
	}
}
