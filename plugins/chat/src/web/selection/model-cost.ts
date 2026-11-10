export type ModelCostTier = "low" | "medium" | "high" | "very-high";

export function modelCostTier(
	cost: { output?: number | undefined } | undefined,
): ModelCostTier | undefined {
	const output = cost?.output;
	if (output === undefined || !Number.isFinite(output) || output <= 0) {
		return undefined;
	}
	if (output <= 1) {
		return "low";
	}
	if (output <= 5) {
		return "medium";
	}
	if (output <= 15) {
		return "high";
	}
	return "very-high";
}
